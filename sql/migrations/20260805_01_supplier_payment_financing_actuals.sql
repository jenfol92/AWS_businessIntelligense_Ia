-- Reapplies the supplier-payment financing implementation after the
-- authorization wrapper moved the executable body to phase1a_impl.
-- Do not re-edit historical migrations: this file is the incremental fix.

BEGIN;

ALTER TABLE public.finance_supplier_payments
  ADD COLUMN IF NOT EXISTS actual_amount_eur numeric(14, 2) NULL;

ALTER TABLE public.finance_supplier_payments
  ADD COLUMN IF NOT EXISTS actual_amount_original numeric(14, 4) NULL;

ALTER TABLE public.finance_supplier_payments
  ADD COLUMN IF NOT EXISTS bank_fee_eur numeric NULL;

ALTER TABLE public.finance_supplier_payments
  ADD COLUMN IF NOT EXISTS ff_fee_eur numeric(14, 2) NULL;

CREATE OR REPLACE FUNCTION public.finance_finance_supplier_payment_phase1a_impl(
  p_supplier_payment_id uuid,
  p_source_type text,
  p_movement_date date,
  p_cash_account_id uuid DEFAULT NULL,
  p_credit_line_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.finance_supplier_payments%rowtype;
  v_cash_account public.finance_cash_accounts%rowtype;
  v_cash_movement public.finance_cash_movements%rowtype;
  v_credit_line public.finance_credit_lines%rowtype;
  v_drawdown_result jsonb;
  v_credit_line_movement_id uuid;
  v_repayment_group_id uuid;
  v_legacy_payment_source text;
  v_payment_amount_eur numeric;
  v_notes text;
BEGIN
  IF p_supplier_payment_id IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND: supplier payment id is required';
  END IF;

  IF p_source_type IS NULL OR p_source_type NOT IN ('cash_account', 'credit_line') THEN
    RAISE EXCEPTION 'INVALID_SOURCE_TYPE: source_type must be cash_account or credit_line';
  END IF;

  IF p_movement_date IS NULL THEN
    RAISE EXCEPTION 'INVALID_DATE: movement_date is required';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.finance_supplier_payments
  WHERE id = p_supplier_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND: supplier payment not found';
  END IF;

  IF v_payment.status <> 'pagado' OR v_payment.paid_at IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_PAID: supplier payment must be paid before financing';
  END IF;

  IF v_payment.actual_amount_eur IS NULL
    OR v_payment.actual_amount_eur <= 0
    OR v_payment.actual_amount_eur::text IN ('NaN', 'Infinity', '-Infinity')
  THEN
    RAISE EXCEPTION 'UNVERIFIED_ACTUAL_AMOUNT: valid real EUR amount is required before financing';
  END IF;

  IF COALESCE(v_payment.bank_fee_eur, 0) < 0
    OR COALESCE(v_payment.bank_fee_eur, 0)::text IN ('NaN', 'Infinity', '-Infinity')
    OR COALESCE(v_payment.ff_fee_eur, 0) < 0
    OR COALESCE(v_payment.ff_fee_eur, 0)::text IN ('NaN', 'Infinity', '-Infinity')
  THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: supplier payment fees must be finite and nonnegative';
  END IF;

  v_payment_amount_eur := round(
    v_payment.actual_amount_eur
    + COALESCE(v_payment.bank_fee_eur, 0)
    + COALESCE(v_payment.ff_fee_eur, 0),
    2
  );

  IF v_payment_amount_eur IS NULL
    OR v_payment_amount_eur <= 0
    OR v_payment_amount_eur::text IN ('NaN', 'Infinity', '-Infinity')
    OR abs(v_payment_amount_eur) >= 1000000000000
  THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: supplier payment financed amount must be greater than 0';
  END IF;

  IF v_payment.payment_source_type IS NOT NULL THEN
    IF v_payment.payment_source_type = p_source_type
      AND (
        (p_source_type = 'cash_account' AND v_payment.cash_account_id = p_cash_account_id)
        OR (p_source_type = 'credit_line' AND v_payment.credit_line_id = p_credit_line_id)
      )
    THEN
      SELECT *
      INTO v_cash_movement
      FROM public.finance_cash_movements
      WHERE movement_type = 'supplier_payment'
        AND source_type = 'supplier_payment'
        AND source_id = v_payment.id
      LIMIT 1;

      SELECT m.id
      INTO v_credit_line_movement_id
      FROM public.finance_credit_line_movements m
      WHERE m.credit_line_id = v_payment.credit_line_id
        AND m.movement_type = 'drawdown'
        AND m.source_type = 'supplier_payment'
        AND m.source_id = v_payment.id
      LIMIT 1;

      IF v_credit_line_movement_id IS NOT NULL THEN
        SELECT repayment_group_id
        INTO v_repayment_group_id
        FROM public.finance_credit_line_movements
        WHERE id = v_credit_line_movement_id;
      END IF;

      RETURN jsonb_build_object(
        'supplier_payment_id', v_payment.id,
        'source_type', v_payment.payment_source_type,
        'cash_account_id', v_payment.cash_account_id,
        'credit_line_id', v_payment.credit_line_id,
        'cash_movement_id', v_cash_movement.id,
        'credit_line_movement_id', v_credit_line_movement_id,
        'repayment_group_id', v_repayment_group_id,
        'amount_eur', v_payment_amount_eur,
        'idempotent', true
      );
    END IF;

    RAISE EXCEPTION 'ALREADY_FINANCED: supplier payment already has a different financing source';
  END IF;

  v_notes := CASE
    WHEN p_notes IS NOT NULL AND trim(p_notes) <> ''
      THEN concat_ws(E'\n', v_payment.notes, p_notes)
    ELSE v_payment.notes
  END;

  IF p_source_type = 'cash_account' THEN
    IF p_cash_account_id IS NULL THEN
      RAISE EXCEPTION 'MISSING_CASH_ACCOUNT: cash_account_id is required';
    END IF;

    SELECT *
    INTO v_cash_account
    FROM public.finance_cash_accounts
    WHERE id = p_cash_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'MISSING_CASH_ACCOUNT: cash account not found';
    END IF;

    IF v_cash_account.balance < v_payment_amount_eur THEN
      RAISE EXCEPTION 'INSUFFICIENT_CASH: cash account balance is lower than supplier payment amount';
    END IF;

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
      'supplier_payment',
      'out',
      v_payment_amount_eur,
      'supplier_payment',
      v_payment.id,
      p_movement_date,
      p_notes,
      now()
    )
    RETURNING * INTO v_cash_movement;

    UPDATE public.finance_cash_accounts
    SET
      balance = balance - v_payment_amount_eur,
      updated_at = now()
    WHERE id = p_cash_account_id
    RETURNING * INTO v_cash_account;

    UPDATE public.finance_supplier_payments
    SET
      payment_source_type = 'cash_account',
      cash_account_id = p_cash_account_id,
      credit_line_id = NULL,
      payment_source = 'cash',
      notes = v_notes,
      updated_at = now()
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;

    RETURN jsonb_build_object(
      'supplier_payment_id', v_payment.id,
      'source_type', v_payment.payment_source_type,
      'cash_account_id', v_payment.cash_account_id,
      'credit_line_id', v_payment.credit_line_id,
      'cash_movement_id', v_cash_movement.id,
      'credit_line_movement_id', NULL,
      'repayment_group_id', NULL,
      'amount_eur', v_payment_amount_eur,
      'idempotent', false
    );
  END IF;

  IF p_source_type = 'credit_line' THEN
    IF p_credit_line_id IS NULL THEN
      RAISE EXCEPTION 'MISSING_CREDIT_LINE: credit_line_id is required';
    END IF;

    v_drawdown_result := public.finance_create_credit_line_drawdown(
      p_credit_line_id,
      v_payment_amount_eur,
      p_movement_date,
      'supplier_payment',
      v_payment.id,
      'Financiacion pago proveedor ' || v_payment.id::text,
      p_idempotency_key
    );

    v_credit_line_movement_id := (v_drawdown_result ->> 'movement_id')::uuid;
    v_repayment_group_id := (v_drawdown_result ->> 'repayment_group_id')::uuid;

    SELECT *
    INTO v_credit_line
    FROM public.finance_credit_lines
    WHERE id = p_credit_line_id;

    v_legacy_payment_source := CASE
      WHEN lower(COALESCE(v_credit_line.bank_name, '')) LIKE '%rural%' THEN 'caja_rural'
      WHEN lower(COALESCE(v_credit_line.bank_name, '')) LIKE '%caixa%' THEN 'la_caixa'
      WHEN lower(COALESCE(v_credit_line.bank_name, '')) LIKE '%bbva%' THEN 'bbva'
      ELSE NULL
    END;

    UPDATE public.finance_supplier_payments
    SET
      payment_source_type = 'credit_line',
      cash_account_id = NULL,
      credit_line_id = p_credit_line_id,
      payment_source = v_legacy_payment_source,
      notes = v_notes,
      updated_at = now()
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;

    RETURN jsonb_build_object(
      'supplier_payment_id', v_payment.id,
      'source_type', v_payment.payment_source_type,
      'cash_account_id', v_payment.cash_account_id,
      'credit_line_id', v_payment.credit_line_id,
      'cash_movement_id', NULL,
      'credit_line_movement_id', v_credit_line_movement_id,
      'repayment_group_id', v_repayment_group_id,
      'amount_eur', v_payment_amount_eur,
      'idempotent', COALESCE((v_drawdown_result ->> 'idempotent')::boolean, false)
    );
  END IF;

  RAISE EXCEPTION 'INVALID_SOURCE_TYPE: source_type must be cash_account or credit_line';
END;
$$;

ALTER FUNCTION public.finance_finance_supplier_payment_phase1a_impl(uuid,text,date,uuid,uuid,text,text)
  OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.finance_finance_supplier_payment_phase1a_impl(uuid,text,date,uuid,uuid,text,text)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.finance_finance_supplier_payment_phase1a_impl(uuid,text,date,uuid,uuid,text,text) IS
  'Implementation for authorized supplier payment financing. Uses actual EUR plus fees and forbids manual supplier payment financing.';

NOTIFY pgrst, 'reload schema';

COMMIT;
