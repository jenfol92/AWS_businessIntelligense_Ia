-- FASE FINANCE-CREDIT-LINE-DRAWDOWN-SOURCE-IDENTITY-FINAL-1
-- Canonical drawdown source identity + manual_due_date rules.
-- Depends on: 20260730_serialize_credit_line_operation_identities.sql
-- Does not apply payments, backfill, or mutate business rows beyond index/function.

BEGIN;

-- ---------------------------------------------------------------------------
-- Unique index on NORMALIZED source identity.
-- Known prior non-normalized definition (20260730) may be replaced.
-- Unexpected definitions abort: DRAWDOWN_SOURCE_INDEX_DEFINITION_MISMATCH.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dupes integer;
  v_indexdef text;
  v_is_canonical boolean;
  v_is_legacy_unnormalized boolean;
BEGIN
  SELECT count(*) INTO v_dupes
  FROM (
    SELECT lower(trim(source_type)) AS src, source_id
    FROM public.finance_credit_line_movements
    WHERE movement_type = 'drawdown'
      AND source_id IS NOT NULL
      AND lower(trim(source_type)) IN ('supplier_payment', 'purchase_payment_batch')
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'DRAWDOWN_SOURCE_DUPLICATES: resolve % duplicate drawdown source identities before unique index; no auto-merge',
      v_dupes;
  END IF;

  SELECT pg_get_indexdef(i.indexrelid)
  INTO v_indexdef
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'ux_finance_credit_line_movements_drawdown_source';

  IF v_indexdef IS NOT NULL THEN
    v_is_canonical :=
      v_indexdef ~* 'lower\s*\(\s*trim'
      AND v_indexdef ILIKE '%movement_type%'
      AND v_indexdef ILIKE '%source_id%'
      AND v_indexdef ILIKE '%drawdown%'
      AND v_indexdef ILIKE '%supplier_payment%'
      AND v_indexdef ILIKE '%purchase_payment_batch%';

    -- Known 20260730 definition: btree (movement_type, source_type, source_id) without lower(trim(...)).
    v_is_legacy_unnormalized :=
      v_indexdef ILIKE '%(movement_type, source_type, source_id)%'
      AND v_indexdef !~* 'lower\s*\(\s*trim';

    IF v_is_canonical THEN
      NULL; -- already correct
    ELSIF v_is_legacy_unnormalized THEN
      DROP INDEX public.ux_finance_credit_line_movements_drawdown_source;
    ELSE
      RAISE EXCEPTION
        'DRAWDOWN_SOURCE_INDEX_DEFINITION_MISMATCH: unexpected index definition for ux_finance_credit_line_movements_drawdown_source: %',
        v_indexdef;
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'ux_finance_credit_line_movements_drawdown_source'
  ) THEN
    CREATE UNIQUE INDEX ux_finance_credit_line_movements_drawdown_source
      ON public.finance_credit_line_movements (
        movement_type,
        (lower(trim(source_type))),
        source_id
      )
      WHERE movement_type = 'drawdown'
        AND lower(trim(source_type)) IN (
          'supplier_payment',
          'purchase_payment_batch'
        )
        AND source_id IS NOT NULL;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Drawdown: source credit_line match + manual_due_date canonicalization
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_create_credit_line_drawdown(
  p_credit_line_id uuid,
  p_amount numeric,
  p_movement_date date,
  p_source_type text,
  p_source_id uuid,
  p_description text,
  p_idempotency_key text DEFAULT NULL,
  p_manual_due_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line public.finance_credit_lines%ROWTYPE;
  v_group public.finance_credit_line_repayment_groups%ROWTYPE;
  v_existing public.finance_credit_line_movements%ROWTYPE;
  v_movement public.finance_credit_line_movements%ROWTYPE;
  v_amount numeric;
  v_period_end date;
  v_due_date date;
  v_key text;
  v_source text;
BEGIN
  IF auth.uid() IS NULL
     AND coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user or service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_credit_line_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_UUID: credit_line_id is required';
  END IF;
  IF p_movement_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: movement_date is required';
  END IF;

  v_source := lower(trim(coalesce(p_source_type, '')));
  IF v_source NOT IN ('supplier_payment', 'purchase_payment_batch') THEN
    RAISE EXCEPTION
      'INVALID_SOURCE_TYPE: drawdown source_type must be supplier_payment or purchase_payment_batch';
  END IF;
  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_SOURCE: source_id is required for credit line drawdown';
  END IF;

  v_amount := public.finance_assert_finite_money(p_amount, 'amount');
  v_key := nullif(trim(p_idempotency_key), '');

  IF v_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('credit_line_operation:' || v_key, 0));

    SELECT * INTO v_existing
    FROM public.finance_credit_line_movements
    WHERE idempotency_key = v_key
    LIMIT 1;

    IF FOUND THEN
      IF v_existing.movement_type <> 'drawdown' THEN
        RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency key belongs to a different movement_type';
      END IF;

      IF v_existing.credit_line_id IS DISTINCT FROM p_credit_line_id
         OR round(v_existing.amount, 4) <> v_amount
         OR v_existing.movement_date IS DISTINCT FROM p_movement_date
         OR lower(trim(coalesce(v_existing.source_type, ''))) IS DISTINCT FROM v_source
         OR v_existing.source_id IS DISTINCT FROM p_source_id
         OR (
           p_manual_due_date IS NOT NULL
           AND v_existing.due_date IS DISTINCT FROM p_manual_due_date
         )
         OR (
           p_manual_due_date IS NULL
           AND EXISTS (
             SELECT 1 FROM public.finance_credit_lines cl
             WHERE cl.id = v_existing.credit_line_id AND cl.cycle_days IS NULL
           )
         )
      THEN
        RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: drawdown idempotency payload differs';
      END IF;

      -- Return balances only for the existing movement's line (already matched above).
      SELECT * INTO v_line FROM public.finance_credit_lines WHERE id = v_existing.credit_line_id;
      IF v_line.cycle_days IS NOT NULL AND p_manual_due_date IS NOT NULL THEN
        RAISE EXCEPTION
          'MANUAL_DUE_DATE_NOT_ALLOWED: credit line has cycle_days; do not pass manual_due_date';
      END IF;

      RETURN jsonb_build_object(
        'movement_id', v_existing.id,
        'repayment_group_id', v_existing.repayment_group_id,
        'credit_line_id', v_existing.credit_line_id,
        'used_amount', v_line.used_amount,
        'available_amount', v_line.available_amount,
        'idempotent', true
      );
    END IF;
  END IF;

  SELECT * INTO v_line
  FROM public.finance_credit_lines
  WHERE id = p_credit_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: credit line not found';
  END IF;

  IF lower(trim(coalesce(v_line.status, ''))) NOT IN ('activa', 'activo', 'active') THEN
    RAISE EXCEPTION 'CREDIT_LINE_INACTIVE: credit line must be active for drawdown';
  END IF;

  IF v_line.cycle_days IS NOT NULL AND p_manual_due_date IS NOT NULL THEN
    RAISE EXCEPTION
      'MANUAL_DUE_DATE_NOT_ALLOWED: credit line has cycle_days; do not pass manual_due_date';
  END IF;

  -- Source identity lock + global lookup (normalized source_type).
  PERFORM pg_advisory_xact_lock(
    hashtextextended('credit_line_drawdown_source:' || v_source || ':' || p_source_id::text, 0)
  );

  SELECT * INTO v_existing
  FROM public.finance_credit_line_movements
  WHERE movement_type = 'drawdown'
    AND lower(trim(source_type)) = v_source
    AND source_id = p_source_id
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.credit_line_id IS DISTINCT FROM p_credit_line_id
       OR round(v_existing.amount, 4) <> v_amount
       OR v_existing.movement_date IS DISTINCT FROM p_movement_date
       OR (
         p_manual_due_date IS NOT NULL
         AND v_existing.due_date IS DISTINCT FROM p_manual_due_date
       )
       OR (
         p_manual_due_date IS NULL
         AND EXISTS (
           SELECT 1 FROM public.finance_credit_lines cl
           WHERE cl.id = v_existing.credit_line_id AND cl.cycle_days IS NULL
         )
       )
    THEN
      RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: drawdown source fallback payload differs';
    END IF;

    -- Proven same credit_line_id: return that line's balances only.
    SELECT * INTO v_line FROM public.finance_credit_lines WHERE id = v_existing.credit_line_id;

    RETURN jsonb_build_object(
      'movement_id', v_existing.id,
      'repayment_group_id', v_existing.repayment_group_id,
      'credit_line_id', v_existing.credit_line_id,
      'used_amount', v_line.used_amount,
      'available_amount', v_line.available_amount,
      'idempotent', true
    );
  END IF;

  IF v_line.available_amount < v_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDIT: available_amount is lower than amount';
  END IF;
  IF v_line.used_amount + v_amount > v_line.credit_limit THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDIT: used_amount would exceed credit_limit';
  END IF;

  IF v_line.cycle_days IS NULL THEN
    IF p_manual_due_date IS NULL THEN
      RAISE EXCEPTION 'MANUAL_DUE_DATE_REQUIRED: credit line has no cycle_days';
    END IF;
    IF p_manual_due_date < p_movement_date THEN
      RAISE EXCEPTION 'INVALID_DATE: manual_due_date must be on or after movement_date';
    END IF;
    v_due_date := p_manual_due_date;
    v_period_end := p_manual_due_date;

    SELECT * INTO v_group
    FROM public.finance_credit_line_repayment_groups
    WHERE credit_line_id = p_credit_line_id
      AND status IN ('open', 'partially_paid')
      AND due_date = v_due_date
    ORDER BY period_start
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.finance_credit_line_repayment_groups (
        credit_line_id, period_start, period_end, due_date,
        amount, paid_amount, remaining_amount, status, updated_at
      ) VALUES (
        p_credit_line_id, p_movement_date, v_period_end, v_due_date,
        0, 0, 0, 'open', now()
      ) RETURNING * INTO v_group;
    END IF;
  ELSE
    SELECT * INTO v_group
    FROM public.finance_credit_line_repayment_groups
    WHERE credit_line_id = p_credit_line_id
      AND status IN ('open', 'partially_paid')
      AND p_movement_date BETWEEN period_start AND period_end
    ORDER BY period_start
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      v_period_end := p_movement_date + v_line.cycle_days;
      v_due_date := v_period_end;
      INSERT INTO public.finance_credit_line_repayment_groups (
        credit_line_id, period_start, period_end, due_date,
        amount, paid_amount, remaining_amount, status, updated_at
      ) VALUES (
        p_credit_line_id, p_movement_date, v_period_end, v_due_date,
        0, 0, 0, 'open', now()
      ) RETURNING * INTO v_group;
    END IF;
  END IF;

  INSERT INTO public.finance_credit_line_movements (
    credit_line_id, movement_type, description, due_date, paid_at, amount, status,
    source_type, source_id, movement_date, repayment_group_id, idempotency_key, updated_at
  ) VALUES (
    p_credit_line_id, 'drawdown',
    coalesce(nullif(trim(p_description), ''), 'Disposicion linea de credito'),
    v_group.due_date, NULL, v_amount, 'posted',
    v_source, p_source_id, p_movement_date, v_group.id, v_key, now()
  ) RETURNING * INTO v_movement;

  UPDATE public.finance_credit_line_repayment_groups
  SET
    amount = amount + v_amount,
    remaining_amount = amount + v_amount - paid_amount,
    updated_at = now()
  WHERE id = v_group.id
  RETURNING * INTO v_group;

  UPDATE public.finance_credit_lines
  SET
    used_amount = used_amount + v_amount,
    available_amount = available_amount - v_amount,
    updated_at = now()
  WHERE id = p_credit_line_id
  RETURNING * INTO v_line;

  RETURN jsonb_build_object(
    'movement_id', v_movement.id,
    'repayment_group_id', v_group.id,
    'credit_line_id', v_line.id,
    'used_amount', v_line.used_amount,
    'available_amount', v_line.available_amount,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
) IS
  'Drawdown via payment RPCs only. Normalized source identity; rejects manual_due_date when cycle_days is set.';

REVOKE EXECUTE ON FUNCTION public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
) TO service_role;
ALTER FUNCTION public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
) OWNER TO postgres;

COMMIT;
