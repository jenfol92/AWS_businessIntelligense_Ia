-- FASE FINANCE-CREDIT-LINE-CONCURRENCY-LOCKS-1
-- Unifies idempotency advisory locks and protects drawdown source identity.
-- Depends on: 20260729_close_credit_line_runtime_invariants.sql
-- Does not apply payments, backfill, or mutate business rows beyond indexes/functions.

BEGIN;

-- ---------------------------------------------------------------------------
-- Schema money ceiling must admit FINANCE_MONEY_MAX_AFTER_ROUND (9999999999.9999).
-- Abort if any audited money column is more restrictive. No auto-fix.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_most_restrictive numeric;
  c_app_max constant numeric := 9999999999.9999; -- FINANCE_MONEY_MAX_AFTER_ROUND
BEGIN
  SELECT min(
    CASE
      WHEN c.numeric_precision IS NULL THEN c_app_max
      ELSE power(10::numeric, c.numeric_precision - coalesce(c.numeric_scale, 0))
           - power(10::numeric, -coalesce(c.numeric_scale, 0))
    END
  )
  INTO v_most_restrictive
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND (
      (c.table_name = 'finance_credit_line_movements' AND c.column_name = 'amount')
      OR (c.table_name = 'finance_credit_line_repayment_groups'
          AND c.column_name IN ('amount', 'paid_amount', 'remaining_amount'))
      OR (c.table_name = 'finance_credit_lines'
          AND c.column_name IN ('credit_limit', 'used_amount', 'available_amount'))
      OR (c.table_name = 'finance_cash_accounts' AND c.column_name = 'balance')
      OR (c.table_name = 'finance_cash_movements' AND c.column_name = 'amount')
    );

  IF v_most_restrictive IS NULL THEN
    RAISE EXCEPTION
      'SCHEMA_MONEY_LIMIT_UNKNOWN: audited money columns not found; cannot validate FINANCE_MONEY_MAX_AFTER_ROUND';
  END IF;

  IF v_most_restrictive < c_app_max THEN
    RAISE EXCEPTION
      'SCHEMA_MONEY_LIMIT_TOO_SMALL: most restrictive column max % < FINANCE_MONEY_MAX_AFTER_ROUND %; aborting without auto-fix',
      v_most_restrictive,
      c_app_max;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Drawdown source_type + source_id uniqueness (abort on duplicates; no merge/delete)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_dupes integer;
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

  CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_credit_line_movements_drawdown_source
    ON public.finance_credit_line_movements (movement_type, source_type, source_id)
    WHERE movement_type = 'drawdown'
      AND source_type IN ('supplier_payment', 'purchase_payment_batch')
      AND source_id IS NOT NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- Drawdown
-- Auth model: project finance writes use authenticated for payment RPCs.
-- Direct drawdown is restricted to service_role; operative paths call it via
-- SECURITY DEFINER parents (create_and_apply / mark_and_finance).
-- source_type whitelist: supplier_payment | purchase_payment_batch only.
-- legacy_opening_balance remains on finance_register_legacy_opening_balance.
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

    -- Global key lookup before type filter (serialize to IDEMPOTENCY_PAYLOAD_MISMATCH, never race to unique index).
    SELECT * INTO v_existing
    FROM public.finance_credit_line_movements
    WHERE idempotency_key = v_key
    LIMIT 1;

    IF FOUND THEN
      IF v_existing.movement_type <> 'drawdown' THEN
        RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency key belongs to a different movement_type';
      END IF;

      IF v_existing.credit_line_id <> p_credit_line_id
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

  -- Source identity lock + lookup (normalized source_type).
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
    IF round(v_existing.amount, 4) <> v_amount
       OR v_existing.movement_date IS DISTINCT FROM p_movement_date
       OR (
         p_manual_due_date IS NOT NULL
         AND v_existing.due_date IS DISTINCT FROM p_manual_due_date
       )
       OR (
         p_manual_due_date IS NULL
         AND v_line.cycle_days IS NULL
       )
    THEN
      RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: drawdown source fallback payload differs';
    END IF;

    RETURN jsonb_build_object(
      'movement_id', v_existing.id,
      'repayment_group_id', v_existing.repayment_group_id,
      'credit_line_id', v_line.id,
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

-- ---------------------------------------------------------------------------
-- Repayment
-- Deleted/eliminada blocked. cancelled/cancelada/inactive remain repayable.
-- Group status cancelled still blocked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finance_create_credit_line_repayment(
  p_credit_line_id uuid,
  p_amount numeric,
  p_movement_date date,
  p_cash_account_id uuid,
  p_repayment_group_id uuid DEFAULT NULL,
  p_source_type text DEFAULT 'manual_repayment',
  p_source_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_bank_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line public.finance_credit_lines%ROWTYPE;
  v_cash_account public.finance_cash_accounts%ROWTYPE;
  v_group public.finance_credit_line_repayment_groups%ROWTYPE;
  v_existing public.finance_credit_line_movements%ROWTYPE;
  v_existing_cash public.finance_cash_movements%ROWTYPE;
  v_movement public.finance_credit_line_movements%ROWTYPE;
  v_cash_movement public.finance_cash_movements%ROWTYPE;
  v_amount numeric;
  v_key text;
  v_bank_ref text;
  v_notes text;
  v_next_remaining numeric;
  v_next_paid numeric;
  v_next_status text;
  v_paid_at timestamptz;
  v_line_status text;
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
  IF p_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_CASH_ACCOUNT: cash_account_id is required';
  END IF;
  IF p_repayment_group_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_REPAYMENT_GROUP: repayment_group_id is required';
  END IF;
  IF p_movement_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: movement_date is required';
  END IF;

  v_source := lower(trim(coalesce(p_source_type, '')));
  IF v_source NOT IN ('repayment_group', 'manual_repayment') THEN
    RAISE EXCEPTION
      'INVALID_SOURCE_TYPE: repayment source_type must be repayment_group or manual_repayment';
  END IF;

  v_amount := public.finance_assert_finite_money(p_amount, 'amount');
  v_key := nullif(trim(p_idempotency_key), '');
  v_bank_ref := nullif(trim(p_bank_reference), '');

  IF v_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('credit_line_operation:' || v_key, 0));

    SELECT * INTO v_existing
    FROM public.finance_credit_line_movements
    WHERE idempotency_key = v_key
    LIMIT 1;

    IF FOUND THEN
      IF v_existing.movement_type <> 'repayment' THEN
        RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency key belongs to a different movement_type';
      END IF;

      IF v_existing.cash_movement_id IS NOT NULL THEN
        SELECT * INTO v_existing_cash
        FROM public.finance_cash_movements
        WHERE id = v_existing.cash_movement_id;
      END IF;

      IF v_existing.credit_line_id <> p_credit_line_id
         OR v_existing.repayment_group_id IS DISTINCT FROM p_repayment_group_id
         OR coalesce(v_existing_cash.cash_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
            IS DISTINCT FROM p_cash_account_id
         OR round(v_existing.amount, 4) <> v_amount
         OR v_existing.movement_date IS DISTINCT FROM p_movement_date
         OR lower(trim(coalesce(v_existing.source_type, ''))) IS DISTINCT FROM v_source
         OR v_existing.source_id IS DISTINCT FROM p_source_id
         OR coalesce(v_existing.bank_reference, '') IS DISTINCT FROM coalesce(v_bank_ref, '')
      THEN
        RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: repayment idempotency payload differs';
      END IF;

      SELECT * INTO v_line FROM public.finance_credit_lines WHERE id = v_existing.credit_line_id;
      SELECT * INTO v_cash_account FROM public.finance_cash_accounts WHERE id = p_cash_account_id;

      RETURN jsonb_build_object(
        'movement_id', v_existing.id,
        'cash_movement_id', v_existing.cash_movement_id,
        'repayment_group_id', v_existing.repayment_group_id,
        'credit_line_id', v_existing.credit_line_id,
        'cash_account_id', p_cash_account_id,
        'used_amount', v_line.used_amount,
        'available_amount', v_line.available_amount,
        'cash_balance', v_cash_account.balance,
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

  v_line_status := lower(trim(coalesce(v_line.status, '')));
  -- Physical deletion only. cancelled/cancelada/inactive remain repayable.
  IF v_line_status IN ('eliminada', 'deleted') THEN
    RAISE EXCEPTION 'CREDIT_LINE_DELETED: credit line is deleted and cannot be repaid';
  END IF;

  SELECT * INTO v_cash_account
  FROM public.finance_cash_accounts
  WHERE id = p_cash_account_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: cash account not found';
  END IF;
  IF upper(trim(coalesce(v_cash_account.currency, ''))) <> 'EUR' THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: cash account must be EUR';
  END IF;

  SELECT * INTO v_group
  FROM public.finance_credit_line_repayment_groups
  WHERE id = p_repayment_group_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: repayment group not found';
  END IF;
  IF v_group.credit_line_id <> p_credit_line_id THEN
    RAISE EXCEPTION 'GROUP_MISMATCH: repayment group does not belong to credit line';
  END IF;
  IF v_group.status = 'cancelled' THEN
    RAISE EXCEPTION 'GROUP_CLOSED: repayment group is cancelled';
  END IF;
  IF v_group.status NOT IN ('open', 'partially_paid') THEN
    RAISE EXCEPTION 'GROUP_CLOSED: repayment group is not payable';
  END IF;
  IF round(v_group.remaining_amount, 4) <= 0 THEN
    RAISE EXCEPTION 'GROUP_CLOSED: repayment group has no remaining amount';
  END IF;

  IF v_source <> '' AND p_source_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.finance_credit_line_movements
    WHERE credit_line_id = p_credit_line_id
      AND movement_type = 'repayment'
      AND lower(trim(source_type)) = v_source
      AND source_id = p_source_id
    LIMIT 1;
    IF FOUND THEN
      IF v_existing.cash_movement_id IS NOT NULL THEN
        SELECT * INTO v_existing_cash
        FROM public.finance_cash_movements
        WHERE id = v_existing.cash_movement_id;
      END IF;
      IF v_existing.repayment_group_id IS DISTINCT FROM p_repayment_group_id
         OR coalesce(v_existing_cash.cash_account_id, '00000000-0000-0000-0000-000000000000'::uuid)
            IS DISTINCT FROM p_cash_account_id
         OR round(v_existing.amount, 4) <> v_amount
         OR v_existing.movement_date IS DISTINCT FROM p_movement_date
         OR coalesce(v_existing.bank_reference, '') IS DISTINCT FROM coalesce(v_bank_ref, '')
      THEN
        RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: repayment source fallback payload differs';
      END IF;
      RETURN jsonb_build_object(
        'movement_id', v_existing.id,
        'cash_movement_id', v_existing.cash_movement_id,
        'repayment_group_id', v_existing.repayment_group_id,
        'credit_line_id', v_line.id,
        'cash_account_id', v_cash_account.id,
        'used_amount', v_line.used_amount,
        'available_amount', v_line.available_amount,
        'cash_balance', v_cash_account.balance,
        'idempotent', true
      );
    END IF;
  END IF;

  IF round(v_line.used_amount, 4) + 0.00005 < v_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_USED_AMOUNT: repayment exceeds used_amount';
  END IF;
  IF round(v_line.available_amount + v_amount, 4) > round(v_line.credit_limit, 4) + 0.00005 THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDIT: available_amount would exceed credit_limit';
  END IF;
  IF round(v_cash_account.balance, 4) + 0.00005 < v_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CASH: cash account balance is lower than amount';
  END IF;
  IF round(v_group.remaining_amount, 4) + 0.00005 < v_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_USED_AMOUNT: repayment exceeds group remaining_amount';
  END IF;

  v_notes := nullif(trim(concat_ws(' | ', p_notes, v_bank_ref)), '');

  INSERT INTO public.finance_credit_line_movements (
    credit_line_id, movement_type, description, due_date, paid_at, amount, status,
    source_type, source_id, movement_date, repayment_group_id, idempotency_key,
    bank_reference, updated_at
  ) VALUES (
    p_credit_line_id, 'repayment',
    coalesce(v_notes, 'Devolucion linea de credito'),
    p_movement_date, p_movement_date::timestamptz, v_amount, 'pagado',
    v_source, p_source_id, p_movement_date, p_repayment_group_id, v_key,
    v_bank_ref, now()
  ) RETURNING * INTO v_movement;

  INSERT INTO public.finance_cash_movements (
    cash_account_id, movement_type, direction, amount, source_type, source_id,
    movement_date, notes, updated_at
  ) VALUES (
    p_cash_account_id, 'credit_repayment', 'out', v_amount,
    'credit_line_movement', v_movement.id, p_movement_date, v_notes, now()
  ) RETURNING * INTO v_cash_movement;

  UPDATE public.finance_credit_line_movements
  SET cash_movement_id = v_cash_movement.id, updated_at = now()
  WHERE id = v_movement.id
  RETURNING * INTO v_movement;

  UPDATE public.finance_credit_lines
  SET
    used_amount = used_amount - v_amount,
    available_amount = available_amount + v_amount,
    updated_at = now()
  WHERE id = p_credit_line_id
  RETURNING * INTO v_line;

  UPDATE public.finance_cash_accounts
  SET balance = balance - v_amount, updated_at = now()
  WHERE id = p_cash_account_id
  RETURNING * INTO v_cash_account;

  v_next_paid := round(v_group.paid_amount + v_amount, 4);
  v_next_remaining := round(v_group.remaining_amount - v_amount, 4);
  IF abs(v_next_remaining) <= 0.00005 THEN
    v_next_remaining := 0;
  END IF;
  v_next_status := CASE WHEN v_next_remaining = 0 THEN 'paid' ELSE 'partially_paid' END;
  v_paid_at := CASE WHEN v_next_status = 'paid' THEN p_movement_date::timestamptz ELSE NULL END;

  UPDATE public.finance_credit_line_repayment_groups
  SET
    paid_amount = v_next_paid,
    remaining_amount = v_next_remaining,
    status = v_next_status,
    paid_at = v_paid_at,
    updated_at = now()
  WHERE id = p_repayment_group_id
  RETURNING * INTO v_group;

  RETURN jsonb_build_object(
    'movement_id', v_movement.id,
    'cash_movement_id', v_cash_movement.id,
    'repayment_group_id', p_repayment_group_id,
    'credit_line_id', v_line.id,
    'cash_account_id', v_cash_account.id,
    'used_amount', v_line.used_amount,
    'available_amount', v_line.available_amount,
    'cash_balance', v_cash_account.balance,
    'group_status', v_group.status,
    'remaining_amount', v_group.remaining_amount,
    'idempotent', false
  );
END;
$$;

COMMENT ON FUNCTION public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
) IS
  'Drawdown via payment RPCs only (EXECUTE: service_role). Canonical sources: supplier_payment, purchase_payment_batch.';

COMMENT ON FUNCTION public.finance_create_credit_line_repayment(
  uuid, numeric, date, uuid, uuid, text, uuid, text, text, text
) IS
  'EUR repayment for non-deleted lines. cancelled/inactive debt remains payable. Shared advisory lock credit_line_operation:<key>.';

REVOKE EXECUTE ON FUNCTION public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.finance_create_credit_line_repayment(
  uuid, numeric, date, uuid, uuid, text, uuid, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_create_credit_line_repayment(
  uuid, numeric, date, uuid, uuid, text, uuid, text, text, text
) TO authenticated, service_role;

ALTER FUNCTION public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
) OWNER TO postgres;
ALTER FUNCTION public.finance_create_credit_line_repayment(
  uuid, numeric, date, uuid, uuid, text, uuid, text, text, text
) OWNER TO postgres;

COMMIT;
