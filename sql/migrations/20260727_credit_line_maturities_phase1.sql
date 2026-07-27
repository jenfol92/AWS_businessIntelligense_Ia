-- FASE FINANCE-CREDIT-LINE-MATURITIES-1
-- Endurece drawdown/repayment: SECURITY DEFINER, EUR, manual_due_date, auth.
-- No regulariza saldos legacy ni inserta datos.

BEGIN;

-- ---------------------------------------------------------------------------
-- Drawdown: optional p_manual_due_date for lines without cycle_days
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
  v_period_end date;
  v_due_date date;
BEGIN
  IF auth.uid() IS NULL
     AND coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user or service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: amount must be greater than 0';
  END IF;

  IF p_movement_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: movement_date is required';
  END IF;

  SELECT *
  INTO v_line
  FROM public.finance_credit_lines
  WHERE id = p_credit_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: credit line not found';
  END IF;

  IF lower(trim(coalesce(v_line.status, ''))) NOT IN ('activa', 'activo', 'active') THEN
    RAISE EXCEPTION 'CREDIT_LINE_INACTIVE: credit line must be active';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.finance_credit_line_movements
    WHERE idempotency_key = p_idempotency_key
      AND movement_type = 'drawdown'
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

  IF p_source_type IS NOT NULL AND p_source_id IS NOT NULL THEN
    SELECT *
    INTO v_existing
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

  IF v_line.available_amount < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDIT: available_amount is lower than amount';
  END IF;

  IF v_line.used_amount + p_amount > v_line.credit_limit THEN
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

    SELECT *
    INTO v_group
    FROM public.finance_credit_line_repayment_groups
    WHERE credit_line_id = p_credit_line_id
      AND status IN ('open', 'partially_paid')
      AND due_date = v_due_date
    ORDER BY period_start
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.finance_credit_line_repayment_groups (
        credit_line_id,
        period_start,
        period_end,
        due_date,
        amount,
        paid_amount,
        remaining_amount,
        status,
        updated_at
      )
      VALUES (
        p_credit_line_id,
        p_movement_date,
        v_period_end,
        v_due_date,
        0,
        0,
        0,
        'open',
        now()
      )
      RETURNING * INTO v_group;
    END IF;
  ELSE
    SELECT *
    INTO v_group
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
        credit_line_id,
        period_start,
        period_end,
        due_date,
        amount,
        paid_amount,
        remaining_amount,
        status,
        updated_at
      )
      VALUES (
        p_credit_line_id,
        p_movement_date,
        v_period_end,
        v_due_date,
        0,
        0,
        0,
        'open',
        now()
      )
      RETURNING * INTO v_group;
    END IF;
  END IF;

  INSERT INTO public.finance_credit_line_movements (
    credit_line_id,
    movement_type,
    description,
    due_date,
    paid_at,
    amount,
    status,
    source_type,
    source_id,
    movement_date,
    repayment_group_id,
    idempotency_key,
    updated_at
  )
  VALUES (
    p_credit_line_id,
    'drawdown',
    coalesce(nullif(trim(p_description), ''), 'Disposicion linea de credito'),
    v_group.due_date,
    NULL,
    p_amount,
    'posted',
    p_source_type,
    p_source_id,
    p_movement_date,
    v_group.id,
    p_idempotency_key,
    now()
  )
  RETURNING * INTO v_movement;

  UPDATE public.finance_credit_line_repayment_groups
  SET
    amount = amount + p_amount,
    remaining_amount = amount + p_amount - paid_amount,
    updated_at = now()
  WHERE id = v_group.id
  RETURNING * INTO v_group;

  UPDATE public.finance_credit_lines
  SET
    used_amount = used_amount + p_amount,
    available_amount = available_amount - p_amount,
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
-- Repayment: EUR-only cash, auth, active line, group state, FOR UPDATE
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
  v_movement public.finance_credit_line_movements%ROWTYPE;
  v_cash_movement public.finance_cash_movements%ROWTYPE;
  v_next_remaining numeric;
  v_next_paid numeric;
  v_next_status text;
  v_paid_at timestamptz;
  v_notes text;
BEGIN
  IF auth.uid() IS NULL
     AND coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION 'UNAUTHORIZED: authenticated user or service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: amount must be greater than 0';
  END IF;

  IF p_movement_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: movement_date is required';
  END IF;

  IF p_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_CASH_ACCOUNT: cash_account_id is required';
  END IF;

  IF p_repayment_group_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_REPAYMENT_GROUP: repayment_group_id is required';
  END IF;

  SELECT *
  INTO v_line
  FROM public.finance_credit_lines
  WHERE id = p_credit_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: credit line not found';
  END IF;

  IF lower(trim(coalesce(v_line.status, ''))) NOT IN ('activa', 'activo', 'active') THEN
    RAISE EXCEPTION 'CREDIT_LINE_INACTIVE: credit line must be active';
  END IF;

  SELECT *
  INTO v_cash_account
  FROM public.finance_cash_accounts
  WHERE id = p_cash_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: cash account not found';
  END IF;

  IF upper(trim(coalesce(v_cash_account.currency, ''))) <> 'EUR' THEN
    RAISE EXCEPTION 'INVALID_CURRENCY: cash account must be EUR';
  END IF;

  SELECT *
  INTO v_group
  FROM public.finance_credit_line_repayment_groups
  WHERE id = p_repayment_group_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: repayment group not found';
  END IF;

  IF v_group.credit_line_id <> p_credit_line_id THEN
    RAISE EXCEPTION 'GROUP_MISMATCH: repayment group does not belong to credit line';
  END IF;

  IF v_group.status NOT IN ('open', 'partially_paid') THEN
    RAISE EXCEPTION 'GROUP_CLOSED: repayment group is not payable';
  END IF;

  IF v_group.remaining_amount <= 0 THEN
    RAISE EXCEPTION 'GROUP_CLOSED: repayment group has no remaining amount';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.finance_credit_line_movements
    WHERE idempotency_key = p_idempotency_key
      AND movement_type = 'repayment'
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

  IF p_source_type IS NOT NULL AND p_source_id IS NOT NULL THEN
    SELECT *
    INTO v_existing
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

  IF v_line.used_amount < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_USED_AMOUNT: repayment exceeds used_amount';
  END IF;

  IF v_line.available_amount + p_amount > v_line.credit_limit THEN
    RAISE EXCEPTION 'INSUFFICIENT_CREDIT: available_amount would exceed credit_limit';
  END IF;

  IF v_cash_account.balance < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_CASH: cash account balance is lower than amount';
  END IF;

  IF v_group.remaining_amount < p_amount THEN
    RAISE EXCEPTION 'INSUFFICIENT_USED_AMOUNT: repayment exceeds group remaining_amount';
  END IF;

  v_notes := nullif(trim(concat_ws(' | ', p_notes, nullif(trim(p_bank_reference), ''))), '');

  INSERT INTO public.finance_credit_line_movements (
    credit_line_id,
    movement_type,
    description,
    due_date,
    paid_at,
    amount,
    status,
    source_type,
    source_id,
    movement_date,
    repayment_group_id,
    idempotency_key,
    updated_at
  )
  VALUES (
    p_credit_line_id,
    'repayment',
    coalesce(v_notes, 'Devolucion linea de credito'),
    p_movement_date,
    p_movement_date::timestamptz,
    p_amount,
    'pagado',
    p_source_type,
    p_source_id,
    p_movement_date,
    p_repayment_group_id,
    p_idempotency_key,
    now()
  )
  RETURNING * INTO v_movement;

  INSERT INTO public.finance_cash_movements (
    cash_account_id,
    movement_type,
    direction,
    amount,
    source_type,
    source_id,
    movement_date,
    notes,
    updated_at
  )
  VALUES (
    p_cash_account_id,
    'credit_repayment',
    'out',
    p_amount,
    'credit_line_movement',
    v_movement.id,
    p_movement_date,
    v_notes,
    now()
  )
  RETURNING * INTO v_cash_movement;

  UPDATE public.finance_credit_line_movements
  SET
    cash_movement_id = v_cash_movement.id,
    updated_at = now()
  WHERE id = v_movement.id
  RETURNING * INTO v_movement;

  UPDATE public.finance_credit_lines
  SET
    used_amount = used_amount - p_amount,
    available_amount = available_amount + p_amount,
    updated_at = now()
  WHERE id = p_credit_line_id
  RETURNING * INTO v_line;

  UPDATE public.finance_cash_accounts
  SET
    balance = balance - p_amount,
    updated_at = now()
  WHERE id = p_cash_account_id
  RETURNING * INTO v_cash_account;

  v_next_paid := v_group.paid_amount + p_amount;
  v_next_remaining := v_group.remaining_amount - p_amount;
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
  'Crea disposicion con repayment group. cycle_days o p_manual_due_date obligatorio.';

COMMENT ON FUNCTION public.finance_create_credit_line_repayment(
  uuid, numeric, date, uuid, uuid, text, uuid, text, text, text
) IS
  'Devolucion atomica desde cuenta EUR. Exige repayment_group_id.';

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

-- Block direct DML from authenticated on ledger tables; writes go through RPC.
REVOKE INSERT, UPDATE, DELETE ON public.finance_credit_line_movements FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.finance_credit_line_repayment_groups FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.finance_cash_movements FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.finance_credit_lines FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.finance_cash_accounts FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.finance_credit_line_movements TO authenticated, service_role;
GRANT SELECT ON public.finance_credit_line_repayment_groups TO authenticated, service_role;
GRANT SELECT ON public.finance_cash_movements TO authenticated, service_role;
GRANT SELECT ON public.finance_credit_lines TO authenticated, service_role;
GRANT SELECT ON public.finance_cash_accounts TO authenticated, service_role;

COMMIT;
