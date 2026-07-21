-- Pago proveedor atómico: marca pagado + financia con fuente real.
-- Fuentes canónicas: cash_account | credit_line. manual queda solo como legacy histórico.

BEGIN;

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
  p_credit_line_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payment public.finance_supplier_payments;
  v_currency text;
  v_actual_fx_rate numeric;
  v_actual_amount_eur numeric;
  v_expected_amount_eur numeric;
  v_financed_amount_eur numeric;
  v_cash_account public.finance_cash_accounts;
  v_cash_movement public.finance_cash_movements;
  v_credit_line public.finance_credit_lines;
  v_drawdown_result jsonb;
  v_credit_line_movement_id uuid;
  v_repayment_group_id uuid;
  v_legacy_payment_source text;
  v_notes text;
  v_movement_date date;
BEGIN
  IF p_supplier_payment_id IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND: payment id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_paid_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_PAID_AT: paid_at is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_type IS NULL OR p_source_type NOT IN ('cash_account', 'credit_line') THEN
    RAISE EXCEPTION 'INVALID_SOURCE_TYPE: source_type must be cash_account or credit_line'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_type = 'manual' THEN
    RAISE EXCEPTION 'INVALID_SOURCE_TYPE: manual funding is not allowed for supplier payments'
      USING ERRCODE = '22023';
  END IF;

  IF p_source_type = 'cash_account' THEN
    IF p_cash_account_id IS NULL OR p_credit_line_id IS NOT NULL THEN
      RAISE EXCEPTION 'MISSING_CASH_ACCOUNT: cash_account_id is required and credit_line_id must be null'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_source_type = 'credit_line' THEN
    IF p_credit_line_id IS NULL OR p_cash_account_id IS NOT NULL THEN
      RAISE EXCEPTION 'MISSING_CREDIT_LINE: credit_line_id is required and cash_account_id must be null'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_actual_fx_rate IS NOT NULL AND (
    p_actual_fx_rate <= 0
    OR p_actual_fx_rate::text IN ('NaN', 'Infinity', '-Infinity')
  ) THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_FX_RATE: actual_fx_rate must be greater than zero'
      USING ERRCODE = '22023';
  END IF;

  IF p_actual_amount_eur IS NOT NULL AND (
    p_actual_amount_eur <= 0
    OR p_actual_amount_eur::text IN ('NaN', 'Infinity', '-Infinity')
  ) THEN
    RAISE EXCEPTION 'INVALID_ACTUAL_AMOUNT_EUR: actual_amount_eur must be greater than zero'
      USING ERRCODE = '22023';
  END IF;

  IF p_bank_fee_eur IS NOT NULL AND (
    p_bank_fee_eur < 0
    OR p_bank_fee_eur::text IN ('NaN', 'Infinity', '-Infinity')
  ) THEN
    RAISE EXCEPTION 'INVALID_BANK_FEE: bank_fee_eur cannot be negative'
      USING ERRCODE = '22023';
  END IF;

  IF p_ff_fee_eur IS NOT NULL AND (
    p_ff_fee_eur < 0
    OR p_ff_fee_eur::text IN ('NaN', 'Infinity', '-Infinity')
  ) THEN
    RAISE EXCEPTION 'INVALID_FF_FEE: ff_fee_eur cannot be negative'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_payment
  FROM public.finance_supplier_payments
  WHERE id = p_supplier_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND: supplier payment not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_order_id IS NOT NULL AND v_payment.orden_id <> p_order_id THEN
    RAISE EXCEPTION 'PAYMENT_ORDER_MISMATCH: payment does not belong to order'
      USING ERRCODE = '22023';
  END IF;

  IF v_payment.status = 'pagado' OR v_payment.paid_at IS NOT NULL THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_ALREADY_PAID: paid values cannot be overwritten'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_payment.payment_source_type = 'manual' THEN
    RAISE EXCEPTION 'LEGACY_MANUAL_PAYMENT: historical manual funding cannot be reused'
      USING ERRCODE = '22023';
  END IF;

  IF v_payment.amount_original IS NULL OR v_payment.amount_original <= 0 THEN
    RAISE EXCEPTION 'INVALID_ORIGINAL_AMOUNT: amount_original must be greater than zero'
      USING ERRCODE = '22023';
  END IF;

  v_currency := upper(trim(coalesce(v_payment.original_currency, '')));
  IF v_currency = '' THEN
    RAISE EXCEPTION 'INVALID_ORIGINAL_CURRENCY: original_currency is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_currency = 'EUR' THEN
    IF p_actual_fx_rate IS NOT NULL AND p_actual_fx_rate <> 1 THEN
      RAISE EXCEPTION 'INCONSISTENT_ACTUAL_VALUES: EUR payments require fx rate 1'
        USING ERRCODE = '22023';
    END IF;
    IF p_actual_amount_eur IS NOT NULL
       AND abs(round(p_actual_amount_eur, 2) - round(v_payment.amount_original, 2)) > 0.01 THEN
      RAISE EXCEPTION 'INCONSISTENT_ACTUAL_VALUES: EUR amount must equal amount_original'
        USING ERRCODE = '22023';
    END IF;
    v_actual_fx_rate := 1;
    v_actual_amount_eur := round(v_payment.amount_original, 2);
  ELSE
    IF p_actual_fx_rate IS NULL AND p_actual_amount_eur IS NULL THEN
      RAISE EXCEPTION 'MISSING_ACTUAL_VALUE: provide actual_fx_rate or actual_amount_eur'
        USING ERRCODE = '22023';
    END IF;

    IF p_actual_fx_rate IS NOT NULL AND p_actual_amount_eur IS NOT NULL THEN
      v_expected_amount_eur := round(v_payment.amount_original * p_actual_fx_rate, 2);
      IF abs(v_expected_amount_eur - round(p_actual_amount_eur, 2)) > 0.01 THEN
        RAISE EXCEPTION 'INCONSISTENT_ACTUAL_VALUES: actual values differ beyond EUR 0.01'
          USING ERRCODE = '22023';
      END IF;
      v_actual_fx_rate := p_actual_fx_rate;
      v_actual_amount_eur := round(p_actual_amount_eur, 2);
    ELSIF p_actual_fx_rate IS NOT NULL THEN
      v_actual_fx_rate := p_actual_fx_rate;
      v_actual_amount_eur := round(v_payment.amount_original * p_actual_fx_rate, 2);
    ELSE
      v_actual_amount_eur := round(p_actual_amount_eur, 2);
      v_actual_fx_rate := v_actual_amount_eur / v_payment.amount_original;
    END IF;
  END IF;

  v_financed_amount_eur :=
    v_actual_amount_eur
    + coalesce(p_bank_fee_eur, v_payment.bank_fee_eur, 0)
    + coalesce(p_ff_fee_eur, v_payment.ff_fee_eur, 0);

  IF v_financed_amount_eur IS NULL OR v_financed_amount_eur <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT: financed amount must be greater than 0'
      USING ERRCODE = '22023';
  END IF;

  v_notes := coalesce(nullif(trim(p_notes), ''), v_payment.notes);
  v_movement_date := (p_paid_at AT TIME ZONE 'UTC')::date;

  IF p_source_type = 'cash_account' THEN
    SELECT *
    INTO v_cash_account
    FROM public.finance_cash_accounts
    WHERE id = p_cash_account_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'MISSING_CASH_ACCOUNT: cash account not found'
        USING ERRCODE = 'P0002';
    END IF;

    IF upper(trim(coalesce(v_cash_account.currency, ''))) <> 'EUR' THEN
      RAISE EXCEPTION 'INVALID_CASH_ACCOUNT_CURRENCY: cash account must be EUR'
        USING ERRCODE = '22023';
    END IF;

    IF v_cash_account.balance < v_financed_amount_eur THEN
      RAISE EXCEPTION 'INSUFFICIENT_CASH: cash account balance is lower than supplier payment amount'
        USING ERRCODE = '22023';
    END IF;

    v_legacy_payment_source := 'cash';

    UPDATE public.finance_supplier_payments
    SET
      status = 'pagado',
      paid_at = p_paid_at,
      actual_fx_rate = v_actual_fx_rate,
      actual_amount_eur = v_actual_amount_eur,
      bank_reference = coalesce(nullif(trim(p_bank_reference), ''), bank_reference),
      bank_fee_eur = coalesce(p_bank_fee_eur, bank_fee_eur),
      ff_fee_eur = coalesce(p_ff_fee_eur, ff_fee_eur),
      payment_source_type = 'cash_account',
      cash_account_id = p_cash_account_id,
      credit_line_id = NULL,
      payment_source = v_legacy_payment_source,
      notes = v_notes,
      updated_at = now()
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;

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
      v_financed_amount_eur,
      'supplier_payment',
      v_payment.id,
      v_movement_date,
      v_notes,
      now()
    )
    RETURNING * INTO v_cash_movement;

    UPDATE public.finance_cash_accounts
    SET
      balance = balance - v_financed_amount_eur,
      updated_at = now()
    WHERE id = p_cash_account_id;

    RETURN jsonb_build_object(
      'payment', to_jsonb(v_payment),
      'source_type', 'cash_account',
      'cash_account_id', v_payment.cash_account_id,
      'credit_line_id', NULL,
      'cash_movement_id', v_cash_movement.id,
      'credit_line_movement_id', NULL,
      'repayment_group_id', NULL,
      'amount_eur', v_financed_amount_eur
    );
  END IF;

  SELECT *
  INTO v_credit_line
  FROM public.finance_credit_lines
  WHERE id = p_credit_line_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MISSING_CREDIT_LINE: credit line not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF lower(trim(coalesce(v_credit_line.status, ''))) <> 'activa' THEN
    RAISE EXCEPTION 'CREDIT_LINE_INACTIVE: credit line must be activa'
      USING ERRCODE = '22023';
  END IF;

  v_legacy_payment_source := CASE
    WHEN lower(coalesce(v_credit_line.bank_name, '')) LIKE '%rural%' THEN 'caja_rural'
    WHEN lower(coalesce(v_credit_line.bank_name, '')) LIKE '%caixa%' THEN 'la_caixa'
    WHEN lower(coalesce(v_credit_line.bank_name, '')) LIKE '%bbva%' THEN 'bbva'
    ELSE 'cash'
  END;

  UPDATE public.finance_supplier_payments
  SET
    status = 'pagado',
    paid_at = p_paid_at,
    actual_fx_rate = v_actual_fx_rate,
    actual_amount_eur = v_actual_amount_eur,
    bank_reference = coalesce(nullif(trim(p_bank_reference), ''), bank_reference),
    bank_fee_eur = coalesce(p_bank_fee_eur, bank_fee_eur),
    ff_fee_eur = coalesce(p_ff_fee_eur, ff_fee_eur),
    payment_source_type = 'credit_line',
    cash_account_id = NULL,
    credit_line_id = p_credit_line_id,
    payment_source = v_legacy_payment_source,
    notes = v_notes,
    updated_at = now()
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  v_drawdown_result := public.finance_create_credit_line_drawdown(
    p_credit_line_id,
    v_financed_amount_eur,
    v_movement_date,
    'supplier_payment',
    v_payment.id,
    coalesce(v_notes, 'Disposición pago proveedor'),
    NULL
  );

  v_credit_line_movement_id := (v_drawdown_result ->> 'movement_id')::uuid;
  v_repayment_group_id := (v_drawdown_result ->> 'repayment_group_id')::uuid;

  RETURN jsonb_build_object(
    'payment', to_jsonb(v_payment),
    'source_type', 'credit_line',
    'cash_account_id', NULL,
    'credit_line_id', v_payment.credit_line_id,
    'cash_movement_id', NULL,
    'credit_line_movement_id', v_credit_line_movement_id,
    'repayment_group_id', v_repayment_group_id,
    'amount_eur', v_financed_amount_eur
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.require_real_funding_on_supplier_payment_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'pagado' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'pagado'
     AND NEW.payment_source_type IS NOT DISTINCT FROM OLD.payment_source_type
     AND NEW.cash_account_id IS NOT DISTINCT FROM OLD.cash_account_id
     AND NEW.credit_line_id IS NOT DISTINCT FROM OLD.credit_line_id
     AND NEW.actual_amount_eur IS NOT DISTINCT FROM OLD.actual_amount_eur
     AND NEW.paid_at IS NOT DISTINCT FROM OLD.paid_at THEN
    RETURN NEW;
  END IF;

  IF NEW.paid_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_PAID_AT: paid_at is required for paid supplier payments'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.actual_amount_eur IS NULL
     OR NEW.actual_amount_eur <= 0
     OR NEW.actual_amount_eur::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'UNVERIFIED_ACTUAL_AMOUNT: valid real EUR amount is required'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.payment_source_type IS NULL OR NEW.payment_source_type = 'manual' THEN
    RAISE EXCEPTION 'INVALID_SOURCE_TYPE: paid supplier payments require cash_account or credit_line'
      USING ERRCODE = '22023';
  END IF;

  IF NEW.payment_source_type = 'cash_account' THEN
    IF NEW.cash_account_id IS NULL OR NEW.credit_line_id IS NOT NULL THEN
      RAISE EXCEPTION 'MISSING_CASH_ACCOUNT: cash_account_id required and credit_line_id must be null'
        USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.payment_source_type = 'credit_line' THEN
    IF NEW.credit_line_id IS NULL OR NEW.cash_account_id IS NOT NULL THEN
      RAISE EXCEPTION 'MISSING_CREDIT_LINE: credit_line_id required and cash_account_id must be null'
        USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_SOURCE_TYPE: unsupported payment_source_type'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_real_funding_on_supplier_payment_paid
  ON public.finance_supplier_payments;
CREATE TRIGGER trg_require_real_funding_on_supplier_payment_paid
BEFORE INSERT OR UPDATE OF status, paid_at, actual_amount_eur,
  payment_source_type, cash_account_id, credit_line_id
ON public.finance_supplier_payments
FOR EACH ROW
EXECUTE FUNCTION public.require_real_funding_on_supplier_payment_paid();

-- mark_supplier_payment_paid queda bloqueado para escrituras nuevas sin fuente real.
CREATE OR REPLACE FUNCTION public.mark_supplier_payment_paid(
  p_supplier_payment_id uuid,
  p_order_id uuid DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL,
  p_actual_fx_rate numeric DEFAULT NULL,
  p_actual_amount_eur numeric DEFAULT NULL,
  p_bank_reference text DEFAULT NULL,
  p_payment_source text DEFAULT NULL,
  p_bank_fee_eur numeric DEFAULT NULL,
  p_ff_fee_eur numeric DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS public.finance_supplier_payments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION
    'MISSING_FUNDING_SOURCE: use mark_and_finance_supplier_payment with cash_account or credit_line'
    USING ERRCODE = '22023';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_and_finance_supplier_payment(
  uuid, uuid, timestamptz, numeric, numeric, text, numeric, numeric, text, text, uuid, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mark_and_finance_supplier_payment(
  uuid, uuid, timestamptz, numeric, numeric, text, numeric, numeric, text, text, uuid, uuid
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.require_real_funding_on_supplier_payment_paid() FROM PUBLIC;

COMMIT;
