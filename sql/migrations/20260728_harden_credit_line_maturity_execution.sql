-- FASE FINANCE-CREDIT-LINE-MATURITIES-HARDEN-1
-- Hardens drawdown/repayment idempotency, inactive-line repayment, numeric
-- safety, and propagates manual_due_date through purchase payment RPCs.
-- Does not backfill or register real payments.

BEGIN;

ALTER TABLE public.finance_credit_line_movements
  ADD COLUMN IF NOT EXISTS bank_reference text NULL;

-- Unique idempotency index only if no duplicates (preflight required).
DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*) INTO v_dupes
  FROM (
    SELECT idempotency_key
    FROM public.finance_credit_line_movements
    WHERE idempotency_key IS NOT NULL
    GROUP BY idempotency_key
    HAVING count(*) > 1
  ) d;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'IDEMPOTENCY_KEY_DUPLICATES: resolve % duplicate keys before creating unique index',
      v_dupes;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS ux_finance_credit_line_movements_idempotency_key
    ON public.finance_credit_line_movements(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.finance_assert_finite_money(p_amount numeric, p_label text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_amount IS NULL THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: % is required', p_label;
  END IF;
  IF p_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: % must be a finite number', p_label;
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: % must be greater than 0', p_label;
  END IF;
  IF abs(p_amount) > 1e12 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: % exceeds storage range', p_label;
  END IF;
  RETURN round(p_amount, 4);
END;
$$;

-- ---------------------------------------------------------------------------
-- Drawdown
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text
);
DROP FUNCTION IF EXISTS public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
);

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

  v_amount := public.finance_assert_finite_money(p_amount, 'amount');
  v_key := nullif(trim(p_idempotency_key), '');

  IF v_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('credit_line_drawdown:' || v_key, 0));

    SELECT * INTO v_existing
    FROM public.finance_credit_line_movements
    WHERE idempotency_key = v_key
      AND movement_type = 'drawdown'
    LIMIT 1;

    IF FOUND THEN
      IF v_existing.credit_line_id <> p_credit_line_id
         OR round(v_existing.amount, 4) <> v_amount
         OR v_existing.movement_date IS DISTINCT FROM p_movement_date
         OR coalesce(v_existing.source_type, '') IS DISTINCT FROM coalesce(p_source_type, '')
         OR v_existing.source_id IS DISTINCT FROM p_source_id
         OR (
           p_manual_due_date IS NOT NULL
           AND v_existing.due_date IS DISTINCT FROM p_manual_due_date
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

  IF p_source_type IS NOT NULL AND p_source_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.finance_credit_line_movements
    WHERE credit_line_id = p_credit_line_id
      AND movement_type = 'drawdown'
      AND source_type = p_source_type
      AND source_id = p_source_id
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'movement_id', v_existing.id,
        'repayment_group_id', v_existing.repayment_group_id,
        'credit_line_id', v_line.id,
        'used_amount', v_line.used_amount,
        'available_amount', v_line.available_amount,
        'idempotent', true
      );
    END IF;
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
    p_source_type, p_source_id, p_movement_date, v_group.id, v_key, now()
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
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.finance_create_credit_line_repayment(
  uuid, numeric, date, uuid, uuid, text, uuid, text, text
);
DROP FUNCTION IF EXISTS public.finance_create_credit_line_repayment(
  uuid, numeric, date, uuid, uuid, text, uuid, text, text, text
);

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

  v_amount := public.finance_assert_finite_money(p_amount, 'amount');
  v_key := nullif(trim(p_idempotency_key), '');
  v_bank_ref := nullif(trim(p_bank_reference), '');

  IF v_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('credit_line_repay:' || v_key, 0));

    SELECT * INTO v_existing
    FROM public.finance_credit_line_movements
    WHERE idempotency_key = v_key
      AND movement_type = 'repayment'
    LIMIT 1;

    IF FOUND THEN
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
         OR coalesce(v_existing.source_type, '') IS DISTINCT FROM coalesce(p_source_type, '')
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
  IF v_line_status IN ('eliminada', 'deleted', 'cancelled', 'cancelada') THEN
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

  IF p_source_type IS NOT NULL AND p_source_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.finance_credit_line_movements
    WHERE credit_line_id = p_credit_line_id
      AND movement_type = 'repayment'
      AND source_type = p_source_type
      AND source_id = p_source_id
    LIMIT 1;
    IF FOUND THEN
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
    p_source_type, p_source_id, p_movement_date, p_repayment_group_id, v_key,
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
  'Drawdown with repayment group. Active lines only. Idempotent under advisory lock.';

COMMENT ON FUNCTION public.finance_create_credit_line_repayment(
  uuid, numeric, date, uuid, uuid, text, uuid, text, text, text
) IS
  'EUR cash repayment. Allows inactive lines with open debt. Idempotent before group-state checks.';

REVOKE EXECUTE ON FUNCTION public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finance_create_credit_line_repayment(
  uuid, numeric, date, uuid, uuid, text, uuid, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finance_create_credit_line_repayment(
  uuid, numeric, date, uuid, uuid, text, uuid, text, text, text
) TO authenticated, service_role;
ALTER FUNCTION public.finance_create_credit_line_drawdown(
  uuid, numeric, date, text, uuid, text, text, date
) OWNER TO postgres;
ALTER FUNCTION public.finance_create_credit_line_repayment(
  uuid, numeric, date, uuid, uuid, text, uuid, text, text, text
) OWNER TO postgres;

REVOKE INSERT, UPDATE, DELETE ON public.finance_credit_line_movements FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.finance_credit_line_repayment_groups FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.finance_cash_movements FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.finance_credit_lines FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.finance_cash_accounts FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Propagate manual_due_date through purchase payment RPCs (patched from 20260722)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_and_apply_purchase_payment_batch(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.finance_purchase_payment_batches;
  v_existing public.finance_purchase_payment_batches;
  v_cash public.finance_cash_accounts;
  v_line public.finance_credit_lines;
  v_cash_movement public.finance_cash_movements;
  v_drawdown jsonb;
  v_alloc jsonb;
  v_payment public.finance_supplier_payments;
  v_order public.ordenes_compra;
  v_allocations jsonb := '[]'::jsonb;
  v_normalized_allocations jsonb := '[]'::jsonb;
  v_obligations jsonb := '[]'::jsonb;
  v_agent_id uuid;
  v_currency text;
  v_source_type text;
  v_cash_id uuid;
  v_line_id uuid;
  v_amount numeric;
  v_actual_fx numeric;
  v_actual_eur numeric;
  v_bank_fee numeric;
  v_ff_fee numeric;
  v_funded_total numeric;
  v_alloc_sum numeric := 0;
  v_previous numeric;
  v_pending numeric;
  v_pending_after numeric;
  v_alloc_original numeric;
  v_alloc_eur numeric;
  v_eur_assigned numeric := 0;
  v_index integer := 0;
  v_count integer;
  v_next_status text;
  v_paid_at timestamptz;
  v_key text;
  v_supplier_payment_id uuid;
  v_payload_fingerprint text;
  v_entry_mode text;
  v_bank_reference text;
  v_notes text;
  v_manual_due_date date;
BEGIN
  IF auth.uid() IS NULL
     AND coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user or service_role required'
      USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_payload->>'payee_type', '') <> 'agent' THEN
    RAISE EXCEPTION 'INVALID_PAYEE_TYPE: this version only supports agent';
  END IF;
  v_key := nullif(trim(p_payload->>'idempotency_key'), '');
  IF v_key IS NULL THEN RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY: idempotency_key is required'; END IF;
  -- Serializa reintentos concurrentes sin conceder INSERT directo a authenticated.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));
  SELECT * INTO v_existing FROM public.finance_purchase_payment_batches WHERE idempotency_key = v_key;

  IF coalesce(p_payload->>'agent_id', '') !~
     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'INVALID_UUID: agent_id must be a UUID';
  END IF;
  IF nullif(p_payload->>'cash_account_id', '') IS NOT NULL
     AND (p_payload->>'cash_account_id') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'INVALID_UUID: cash_account_id must be a UUID';
  END IF;
  IF nullif(p_payload->>'credit_line_id', '') IS NOT NULL
     AND (p_payload->>'credit_line_id') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
    RAISE EXCEPTION 'INVALID_UUID: credit_line_id must be a UUID';
  END IF;
  IF coalesce(p_payload->>'paid_at', '') !~
     '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T.*)?$' THEN
    RAISE EXCEPTION 'INVALID_PAID_AT: paid_at must be a valid date';
  END IF;
  BEGIN
    v_paid_at := (p_payload->>'paid_at')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'INVALID_PAID_AT: paid_at must be a valid date';
  END;

  v_agent_id := (p_payload->>'agent_id')::uuid;
  v_currency := upper(trim(p_payload->>'original_currency'));
  IF v_currency IS NULL OR v_currency = ''
     OR v_currency NOT IN ('USD', 'EUR', 'GBP', 'CNY') THEN
    RAISE EXCEPTION 'INVALID_PLAN_CURRENCY: unsupported original_currency';
  END IF;
  v_entry_mode := nullif(trim(p_payload->>'entry_mode'), '');
  IF v_entry_mode IS NULL OR v_entry_mode NOT IN ('free_amount', 'selected_payments') THEN
    RAISE EXCEPTION 'INVALID_ENTRY_MODE: unsupported entry_mode';
  END IF;
  v_source_type := p_payload->>'source_type';
  v_cash_id := nullif(p_payload->>'cash_account_id', '')::uuid;
  v_line_id := nullif(p_payload->>'credit_line_id', '')::uuid;
  v_bank_reference := nullif(trim(p_payload->>'bank_reference'), '');
  v_notes := nullif(trim(p_payload->>'notes'), '');
  BEGIN
    v_manual_due_date := nullif(p_payload->>'manual_due_date', '')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'INVALID_DATE: manual_due_date must be a valid date';
  END;
  BEGIN
    v_amount := (p_payload->>'amount_original')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: amount_original must be numeric';
  END;
  BEGIN
    v_actual_fx := nullif(p_payload->>'actual_fx_rate', '')::numeric;
    v_actual_eur := nullif(p_payload->>'actual_amount_eur', '')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_VALUES: actual values must be numeric';
  END;
  BEGIN
    v_bank_fee := coalesce((p_payload->>'bank_fee_eur')::numeric, 0);
    v_ff_fee := coalesce((p_payload->>'ff_fee_eur')::numeric, 0);
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'INVALID_FEE: fees must be numeric';
  END;

  v_amount := round(v_amount, 4);
  v_actual_fx := CASE WHEN v_actual_fx IS NULL THEN NULL ELSE round(v_actual_fx, 8) END;
  v_actual_eur := CASE WHEN v_actual_eur IS NULL THEN NULL ELSE round(v_actual_eur, 2) END;
  v_bank_fee := round(v_bank_fee, 2);
  v_ff_fee := round(v_ff_fee, 2);
  IF v_agent_id IS NULL THEN RAISE EXCEPTION 'MISSING_AGENT: agent_id is required'; END IF;
  IF NOT public.finance_is_finite_numeric(v_amount) OR v_amount <= 0 OR abs(v_amount) >= 10000000000 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: amount_original must be finite and positive';
  END IF;
  IF v_actual_fx IS NOT NULL
     AND (NOT public.finance_is_finite_numeric(v_actual_fx) OR abs(v_actual_fx) >= 10000000000) THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_VALUES: actual_fx_rate must be finite';
  END IF;
  IF v_actual_eur IS NOT NULL
     AND (NOT public.finance_is_finite_numeric(v_actual_eur) OR abs(v_actual_eur) >= 1000000000000) THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_VALUES: actual_amount_eur must be finite';
  END IF;
  IF NOT public.finance_is_finite_numeric(v_bank_fee) OR v_bank_fee < 0
     OR abs(v_bank_fee) >= 1000000000000
     OR NOT public.finance_is_finite_numeric(v_ff_fee) OR v_ff_fee < 0
     OR abs(v_ff_fee) >= 1000000000000 THEN
    RAISE EXCEPTION 'INVALID_FEE: fees must be finite and nonnegative';
  END IF;
  IF v_currency = 'EUR' THEN
    IF v_actual_fx IS NOT NULL AND abs(v_actual_fx - 1) > 0.00000001 THEN
      RAISE EXCEPTION 'INCONSISTENT_ACTUAL_VALUES: EUR requires fx rate 1';
    END IF;
    IF v_actual_eur IS NOT NULL AND abs(round(v_actual_eur, 2) - round(v_amount, 2)) > 0.01 THEN
      RAISE EXCEPTION 'INCONSISTENT_ACTUAL_VALUES: EUR principal must equal original amount';
    END IF;
    v_actual_fx := 1; v_actual_eur := round(v_amount, 2);
  ELSIF v_actual_fx IS NULL AND v_actual_eur IS NULL THEN
    RAISE EXCEPTION 'MISSING_ACTUAL_VALUE: actual_fx_rate or actual_amount_eur is required';
  ELSIF v_actual_fx IS NULL THEN
    v_actual_eur := round(v_actual_eur, 2); v_actual_fx := v_actual_eur / v_amount;
  ELSIF v_actual_eur IS NULL THEN
    v_actual_eur := round(v_amount * v_actual_fx, 2);
  ELSIF abs(round(v_amount * v_actual_fx, 2) - round(v_actual_eur, 2)) > 0.01 THEN
    RAISE EXCEPTION 'INCONSISTENT_ACTUAL_VALUES: actual values differ beyond EUR 0.01';
  ELSE
    v_actual_eur := round(v_actual_eur, 2);
  END IF;
  v_actual_fx := round(v_actual_fx, 8);
  v_actual_eur := round(v_actual_eur, 2);
  IF NOT public.finance_is_finite_numeric(v_actual_fx) OR v_actual_fx <= 0
     OR NOT public.finance_is_finite_numeric(v_actual_eur) OR v_actual_eur <= 0 THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_VALUES: actual amounts and fees are invalid';
  END IF;
  v_funded_total := round(v_actual_eur + v_bank_fee + v_ff_fee, 2);
  IF NOT public.finance_is_finite_numeric(v_funded_total) OR v_funded_total <= 0
     OR abs(v_funded_total) >= 1000000000000 THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_VALUES: funded_total_eur must be finite and positive';
  END IF;

  IF jsonb_typeof(p_payload->'allocations') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_ALLOCATIONS: allocations must be an array';
  END IF;
  IF jsonb_array_length(p_payload->'allocations') = 0 THEN
    RAISE EXCEPTION 'INVALID_ALLOCATIONS: at least one allocation is required';
  END IF;
  v_count := jsonb_array_length(p_payload->'allocations');
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_payload->'allocations') item
    WHERE coalesce(item->>'supplier_payment_id', '') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  ) THEN
    RAISE EXCEPTION 'INVALID_UUID: supplier_payment_id must be a UUID';
  END IF;
  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_payload->'allocations')
  LOOP
    BEGIN
      v_alloc_original := (v_alloc->>'allocated_amount_original')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: allocated_amount_original must be numeric';
    END;
    v_alloc_original := round(v_alloc_original, 4);
    IF NOT public.finance_is_finite_numeric(v_alloc_original) OR v_alloc_original <= 0
       OR abs(v_alloc_original) >= 10000000000 THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: allocation must be finite and positive';
    END IF;
    v_normalized_allocations := v_normalized_allocations || jsonb_build_array(jsonb_build_object(
      'supplier_payment_id', v_alloc->>'supplier_payment_id',
      'allocated_amount_original', v_alloc_original
    ));
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_normalized_allocations) item
    GROUP BY item->>'supplier_payment_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_ALLOCATION: supplier_payment_id cannot be repeated';
  END IF;

  SELECT md5(jsonb_build_object(
    'payee_type', 'agent',
    'agent_id', v_agent_id,
    'entry_mode', v_entry_mode,
    'original_currency', v_currency,
    'amount_original', v_amount,
    'actual_fx_rate', v_actual_fx,
    'actual_amount_eur', v_actual_eur,
    'bank_fee_eur', v_bank_fee,
    'ff_fee_eur', v_ff_fee,
    'funded_total_eur', v_funded_total,
    'source_type', v_source_type,
    'cash_account_id', v_cash_id,
    'credit_line_id', v_line_id,
    'paid_at', v_paid_at,
    'bank_reference', v_bank_reference,
    'notes', v_notes,
    'manual_due_date', v_manual_due_date,
    'allocations', (
      SELECT jsonb_agg(jsonb_build_object(
        'supplier_payment_id', item->>'supplier_payment_id',
        'allocated_amount_original', (item->>'allocated_amount_original')::numeric
      ) ORDER BY item->>'supplier_payment_id')
      FROM jsonb_array_elements(v_normalized_allocations) item
    )
  )::text)
  INTO v_payload_fingerprint;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.payload_fingerprint IS DISTINCT FROM v_payload_fingerprint THEN
      RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency key belongs to a different payload';
    END IF;
    RETURN public.get_purchase_payment_batch_detail(v_existing.id)
      || jsonb_build_object('idempotent', true);
  END IF;

  -- Lock in stable UUID order before calculating any balance.
  PERFORM sp.id
  FROM public.finance_supplier_payments sp
  WHERE sp.id IN (
    SELECT (item->>'supplier_payment_id')::uuid
    FROM jsonb_array_elements(v_normalized_allocations) item
  )
  ORDER BY sp.id
  FOR UPDATE;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_normalized_allocations)
  LOOP
    SELECT * INTO v_payment FROM public.finance_supplier_payments
      WHERE id = (v_alloc->>'supplier_payment_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'OBLIGATION_NOT_FOUND: supplier payment not found'; END IF;
    IF v_payment.payment_source_type = 'manual' THEN
      RAISE EXCEPTION 'LEGACY_MANUAL_PAYMENT: legacy manual obligations are read-only';
    END IF;
    SELECT * INTO v_order FROM public.ordenes_compra WHERE id = v_payment.orden_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND: obligation order not found'; END IF;
    IF v_order.estado <> 'confirmado' THEN
      RAISE EXCEPTION 'ORDER_NOT_CONFIRMED: obligation order must be confirmed';
    END IF;
    IF v_order.agente_id IS NULL THEN RAISE EXCEPTION 'MISSING_AGENT: obligation order has no agent'; END IF;
    IF v_order.agente_id <> v_agent_id THEN RAISE EXCEPTION 'AGENT_MISMATCH: all obligations must use the same agent'; END IF;
    IF upper(trim(v_payment.original_currency)) <> v_currency THEN
      RAISE EXCEPTION 'CURRENCY_MISMATCH: all obligations must use the same currency';
    END IF;
    SELECT coalesce(sum(a.allocated_amount_original), 0) INTO v_previous
    FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE a.supplier_payment_id = v_payment.id AND b.status <> 'reversed';
    v_pending := v_payment.amount_original - v_previous;
    v_alloc_original := (v_alloc->>'allocated_amount_original')::numeric;
    IF NOT public.finance_is_finite_numeric(v_previous)
       OR NOT public.finance_is_finite_numeric(v_pending)
       OR NOT public.finance_is_finite_numeric(v_alloc_original)
       OR v_alloc_original <= 0 THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: allocation values must be finite and positive';
    END IF;
    IF v_pending <= 0.0001 OR v_payment.status = 'pagado' THEN
      RAISE EXCEPTION 'OBLIGATION_ALREADY_PAID: obligation has no pending balance';
    END IF;
    IF v_alloc_original <= 0 OR v_alloc_original - v_pending > 0.0001 THEN
      RAISE EXCEPTION 'OVERALLOCATION: allocation exceeds real pending balance';
    END IF;
    v_alloc_sum := v_alloc_sum + v_alloc_original;
    IF NOT public.finance_is_finite_numeric(v_alloc_sum) THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: allocation sum must be finite';
    END IF;
  END LOOP;
  IF abs(v_alloc_sum - v_amount) > 0.0001 THEN
    RAISE EXCEPTION 'ALLOCATION_SUM_MISMATCH: allocations must equal batch principal';
  END IF;

  IF v_source_type = 'cash_account' THEN
    IF v_cash_id IS NULL OR v_line_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_SOURCE: select exactly one cash account'; END IF;
    SELECT * INTO v_cash FROM public.finance_cash_accounts WHERE id = v_cash_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CASH_ACCOUNT_NOT_FOUND: cash account not found'; END IF;
    IF upper(trim(v_cash.currency)) <> 'EUR' THEN RAISE EXCEPTION 'INVALID_CASH_ACCOUNT_CURRENCY: cash account must be EUR'; END IF;
    IF v_cash.balance < v_funded_total THEN RAISE EXCEPTION 'INSUFFICIENT_CASH: insufficient cash balance'; END IF;
  ELSIF v_source_type = 'credit_line' THEN
    IF v_line_id IS NULL OR v_cash_id IS NOT NULL THEN RAISE EXCEPTION 'INVALID_SOURCE: select exactly one credit line'; END IF;
    SELECT * INTO v_line FROM public.finance_credit_lines WHERE id = v_line_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CREDIT_LINE_NOT_FOUND: credit line not found'; END IF;
    IF lower(trim(v_line.status)) NOT IN ('activa', 'activo', 'active') THEN RAISE EXCEPTION 'CREDIT_LINE_INACTIVE: credit line is inactive'; END IF;
    IF v_line.cycle_days IS NULL AND v_manual_due_date IS NULL THEN
      RAISE EXCEPTION 'MANUAL_DUE_DATE_REQUIRED: credit line has no cycle_days';
    END IF;
    IF v_manual_due_date IS NOT NULL AND v_manual_due_date < (v_paid_at AT TIME ZONE 'UTC')::date THEN
      RAISE EXCEPTION 'INVALID_DATE: manual_due_date must be on or after paid_at';
    END IF;
    IF v_line.available_amount < v_funded_total THEN RAISE EXCEPTION 'INSUFFICIENT_CREDIT: insufficient credit'; END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_SOURCE_TYPE: source must be cash_account or credit_line';
  END IF;

  BEGIN
    INSERT INTO public.finance_purchase_payment_batches (
      payee_type, agent_id, paid_at, original_currency, amount_original,
      actual_fx_rate, actual_amount_eur, bank_fee_eur, ff_fee_eur, funded_total_eur,
      source_type, cash_account_id, credit_line_id, bank_reference, notes,
      entry_mode, idempotency_key, payload_fingerprint, created_by
    ) VALUES (
      'agent', v_agent_id, v_paid_at, v_currency, v_amount,
      v_actual_fx, v_actual_eur, v_bank_fee, v_ff_fee, v_funded_total,
      v_source_type, v_cash_id, v_line_id, v_bank_reference,
      v_notes, v_entry_mode, v_key,
      v_payload_fingerprint, auth.uid()
    ) RETURNING * INTO v_batch;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.finance_purchase_payment_batches
    WHERE idempotency_key = v_key;
    IF FOUND THEN
      IF v_existing.payload_fingerprint IS DISTINCT FROM v_payload_fingerprint THEN
        RAISE EXCEPTION 'IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency key belongs to a different payload';
      END IF;
      RETURN public.get_purchase_payment_batch_detail(v_existing.id)
        || jsonb_build_object('idempotent', true);
    END IF;
    RAISE;
  END;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(v_normalized_allocations)
  LOOP
    v_supplier_payment_id := (v_alloc->>'supplier_payment_id')::uuid;
    v_index := v_index + 1;
    v_alloc_original := (v_alloc->>'allocated_amount_original')::numeric;
    SELECT * INTO v_payment
    FROM public.finance_supplier_payments
    WHERE id = v_supplier_payment_id;
    SELECT coalesce(sum(a.allocated_amount_original), 0) INTO v_previous
    FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE a.supplier_payment_id = v_supplier_payment_id AND b.status <> 'reversed';
    v_pending := v_payment.amount_original - v_previous;
    v_pending_after := greatest(v_pending - v_alloc_original, 0);
    v_next_status := CASE WHEN v_pending_after <= 0.0001 THEN 'pagado' ELSE 'parcial' END;
    v_alloc_eur := CASE WHEN v_index = v_count
      THEN v_actual_eur - v_eur_assigned
      ELSE round(v_alloc_original * v_actual_fx, 2)
    END;
    IF NOT public.finance_is_finite_numeric(v_pending)
       OR NOT public.finance_is_finite_numeric(v_pending_after)
       OR NOT public.finance_is_finite_numeric(v_alloc_eur)
       OR v_alloc_eur <= 0 THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: calculated allocation values must be finite and positive';
    END IF;
    v_eur_assigned := v_eur_assigned + v_alloc_eur;
    IF NOT public.finance_is_finite_numeric(v_eur_assigned) THEN
      RAISE EXCEPTION 'INVALID_ALLOCATION_AMOUNT: EUR allocation sum must be finite';
    END IF;
    INSERT INTO public.finance_purchase_payment_allocations (
      batch_id, supplier_payment_id, allocated_amount_original, allocated_amount_eur,
      pending_before_original, pending_after_original, resulting_status
    ) VALUES (
      v_batch.id, v_supplier_payment_id, v_alloc_original, v_alloc_eur,
      v_pending, v_pending_after, v_next_status
    ) RETURNING to_jsonb(finance_purchase_payment_allocations.*) INTO v_alloc;
    v_allocations := v_allocations || jsonb_build_array(v_alloc);

    SELECT * INTO v_payment FROM public.finance_supplier_payments
      WHERE id = v_supplier_payment_id;
    SELECT coalesce(sum(a.allocated_amount_original), 0) INTO v_previous
    FROM public.finance_purchase_payment_allocations a
    JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
    WHERE a.supplier_payment_id = v_payment.id AND b.status <> 'reversed';
    UPDATE public.finance_supplier_payments SET
      status = v_next_status,
      paid_at = CASE WHEN v_next_status = 'pagado' THEN v_paid_at ELSE NULL END,
      actual_amount_original = v_previous,
      actual_amount_eur = (
        SELECT sum(a.allocated_amount_eur)
        FROM public.finance_purchase_payment_allocations a
        JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
        WHERE a.supplier_payment_id = v_payment.id AND b.status <> 'reversed'
      ),
      actual_fx_rate = CASE WHEN v_previous > 0 THEN (
        SELECT sum(a.allocated_amount_eur)
        FROM public.finance_purchase_payment_allocations a
        JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
        WHERE a.supplier_payment_id = v_payment.id AND b.status <> 'reversed'
      ) / v_previous ELSE NULL END,
      payment_source_type = v_source_type,
      cash_account_id = CASE WHEN v_source_type = 'cash_account' THEN v_cash_id ELSE NULL END,
      credit_line_id = CASE WHEN v_source_type = 'credit_line' THEN v_line_id ELSE NULL END,
      updated_at = now()
    WHERE id = v_payment.id
    RETURNING to_jsonb(finance_supplier_payments.*) INTO v_alloc;
    v_obligations := v_obligations || jsonb_build_array(v_alloc);
  END LOOP;

  -- El ledger actual solo admite un movimiento supplier_payment; conserva el desglose en el batch.
  IF v_source_type = 'cash_account' THEN
    INSERT INTO public.finance_cash_movements (
      cash_account_id, movement_type, direction, amount, source_type, source_id,
      movement_date, notes, updated_at
    ) VALUES (
      v_cash_id, 'supplier_payment', 'out', v_funded_total,
      'purchase_payment_batch', v_batch.id, (v_paid_at AT TIME ZONE 'UTC')::date,
      concat_ws(' | ', p_payload->>'notes',
        'principal EUR ' || v_actual_eur,
        'comision EUR ' || v_bank_fee,
        'FF EUR ' || v_ff_fee), now()
    ) RETURNING * INTO v_cash_movement;
    UPDATE public.finance_cash_accounts SET balance = balance - v_funded_total, updated_at = now()
      WHERE id = v_cash_id;
    UPDATE public.finance_purchase_payment_batches SET cash_movement_id = v_cash_movement.id
      WHERE id = v_batch.id RETURNING * INTO v_batch;
  ELSE
    v_drawdown := public.finance_create_credit_line_drawdown(
      v_line_id, v_funded_total, (v_paid_at AT TIME ZONE 'UTC')::date,
      'purchase_payment_batch', v_batch.id,
      coalesce(nullif(trim(p_payload->>'notes'), ''), 'Pago vinculado a agente'),
      v_key || ':drawdown',
      v_manual_due_date
    );
    UPDATE public.finance_purchase_payment_batches SET
      credit_line_movement_id = (v_drawdown->>'movement_id')::uuid,
      repayment_group_id = (v_drawdown->>'repayment_group_id')::uuid
    WHERE id = v_batch.id RETURNING * INTO v_batch;
  END IF;

  RETURN jsonb_build_object(
    'batch', to_jsonb(v_batch),
    'allocations', v_allocations,
    'movement', CASE WHEN v_source_type = 'cash_account'
      THEN to_jsonb(v_cash_movement) ELSE v_drawdown END,
    'obligations', v_obligations,
    'idempotent', false
  );
END;
$$;

-- El refresco de planificación nunca puede degradar ni reescribir settlement real.

CREATE OR REPLACE FUNCTION public.mark_and_finance_supplier_payment(
  p_supplier_payment_id uuid,
  p_order_id uuid DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL,
  p_actual_fx_rate numeric DEFAULT NULL,
  p_actual_amount_eur numeric DEFAULT NULL,
  p_bank_reference text DEFAULT NULL,
  p_bank_fee_eur numeric DEFAULT NULL,
  p_ff_fee_eur numeric DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_source_type text DEFAULT NULL,
  p_cash_account_id uuid DEFAULT NULL,
  p_credit_line_id uuid DEFAULT NULL,
  p_manual_due_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payment public.finance_supplier_payments;
  v_order public.ordenes_compra;
  v_result jsonb;
  v_updated jsonb;
  v_previous numeric;
  v_pending numeric;
  v_existing_batch public.finance_purchase_payment_batches;
BEGIN
  IF auth.uid() IS NULL
     AND coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user or service_role required'
      USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_payment
  FROM public.finance_supplier_payments
  WHERE id = p_supplier_payment_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND: supplier payment not found'; END IF;
  IF v_payment.payment_source_type = 'manual' THEN
    RAISE EXCEPTION 'LEGACY_MANUAL_PAYMENT: legacy manual obligations are read-only';
  END IF;
  IF p_order_id IS NOT NULL AND p_order_id <> v_payment.orden_id THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_MISMATCH: payment does not belong to order';
  END IF;
  SELECT * INTO v_order FROM public.ordenes_compra WHERE id = v_payment.orden_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND: order not found'; END IF;
  IF v_order.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'ORDER_NOT_CONFIRMED: order must be confirmed';
  END IF;
  IF v_order.agente_id IS NULL THEN RAISE EXCEPTION 'MISSING_AGENT: order has no purchase agent'; END IF;
  SELECT coalesce(sum(a.allocated_amount_original), 0) INTO v_previous
  FROM public.finance_purchase_payment_allocations a
  JOIN public.finance_purchase_payment_batches b ON b.id = a.batch_id
  WHERE a.supplier_payment_id = v_payment.id AND b.status <> 'reversed';
  v_pending := v_payment.amount_original - v_previous;
  IF v_pending <= 0.0001 THEN
    SELECT * INTO v_existing_batch
    FROM public.finance_purchase_payment_batches
    WHERE idempotency_key = 'individual-supplier-payment:' || p_supplier_payment_id::text;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'OBLIGATION_ALREADY_PAID: obligation has no pending balance';
    END IF;
    v_pending := v_existing_batch.amount_original;
  END IF;

  v_result := public.create_and_apply_purchase_payment_batch(jsonb_build_object(
    'payee_type', 'agent',
    'agent_id', v_order.agente_id,
    'entry_mode', 'selected_payments',
    'amount_original', v_pending,
    'original_currency', v_payment.original_currency,
    'actual_fx_rate', p_actual_fx_rate,
    'actual_amount_eur', p_actual_amount_eur,
    'bank_fee_eur', coalesce(p_bank_fee_eur, 0),
    'ff_fee_eur', coalesce(p_ff_fee_eur, 0),
    'paid_at', p_paid_at,
    'bank_reference', p_bank_reference,
    'notes', p_notes,
    'source_type', p_source_type,
    'cash_account_id', p_cash_account_id,
    'credit_line_id', p_credit_line_id,
    'manual_due_date', p_manual_due_date,
    'idempotency_key', 'individual-supplier-payment:' || p_supplier_payment_id::text,
    'allocations', jsonb_build_array(jsonb_build_object(
      'supplier_payment_id', p_supplier_payment_id,
      'allocated_amount_original', v_pending
    ))
  ));

  SELECT to_jsonb(sp) INTO v_updated
  FROM public.finance_supplier_payments sp
  WHERE sp.id = p_supplier_payment_id;

  RETURN jsonb_build_object(
    'payment', v_updated,
    'source_type', v_result->'batch'->>'source_type',
    'cash_account_id', v_result->'batch'->'cash_account_id',
    'credit_line_id', v_result->'batch'->'credit_line_id',
    'cash_movement_id', v_result->'batch'->'cash_movement_id',
    'credit_line_movement_id', v_result->'batch'->'credit_line_movement_id',
    'repayment_group_id', v_result->'batch'->'repayment_group_id',
    'supplier_amount_eur', v_result->'batch'->'actual_amount_eur',
    'bank_fee_eur', v_result->'batch'->'bank_fee_eur',
    'ff_fee_eur', v_result->'batch'->'ff_fee_eur',
    'funded_total_eur', v_result->'batch'->'funded_total_eur',
    'batch_id', v_result->'batch'->'id',
    'idempotent', coalesce((v_result->>'idempotent')::boolean, false)
  );
END;
$$;


DROP FUNCTION IF EXISTS public.mark_and_finance_supplier_payment(
  uuid, uuid, timestamptz, numeric, numeric, text, numeric, numeric, text, text, uuid, uuid
);

REVOKE EXECUTE ON FUNCTION public.mark_and_finance_supplier_payment(
  uuid, uuid, timestamptz, numeric, numeric, text, numeric, numeric, text, text, uuid, uuid, date
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_and_finance_supplier_payment(
  uuid, uuid, timestamptz, numeric, numeric, text, numeric, numeric, text, text, uuid, uuid, date
) TO authenticated, service_role;
ALTER FUNCTION public.mark_and_finance_supplier_payment(
  uuid, uuid, timestamptz, numeric, numeric, text, numeric, numeric, text, text, uuid, uuid, date
) OWNER TO postgres;

ALTER FUNCTION public.create_and_apply_purchase_payment_batch(jsonb) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.create_and_apply_purchase_payment_batch(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_and_apply_purchase_payment_batch(jsonb) TO authenticated, service_role;

COMMIT;
