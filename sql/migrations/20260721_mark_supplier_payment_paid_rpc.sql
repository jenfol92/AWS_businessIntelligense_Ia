-- Ejecucion atomica e idempotente del pago proveedor.
-- amount_eur permanece legacy; los valores bancarios reales viven en cada pago.

BEGIN;

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
AS $$
DECLARE
  v_payment public.finance_supplier_payments;
  v_currency text;
  v_actual_fx_rate numeric;
  v_actual_amount_eur numeric;
  v_expected_amount_eur numeric;
BEGIN
  IF p_supplier_payment_id IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND: payment id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_paid_at IS NULL THEN
    RAISE EXCEPTION 'INVALID_PAID_AT: paid_at is required'
      USING ERRCODE = '22023';
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

  IF p_payment_source IS NOT NULL
     AND p_payment_source NOT IN ('cash', 'caja_rural', 'la_caixa', 'bbva') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_SOURCE: unsupported payment source'
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

  UPDATE public.finance_supplier_payments
  SET
    status = 'pagado',
    paid_at = p_paid_at,
    actual_fx_rate = v_actual_fx_rate,
    actual_amount_eur = v_actual_amount_eur,
    bank_reference = nullif(trim(p_bank_reference), ''),
    payment_source = coalesce(p_payment_source, payment_source),
    bank_fee_eur = p_bank_fee_eur,
    ff_fee_eur = p_ff_fee_eur,
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    updated_at = now()
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$$;

CREATE OR REPLACE FUNCTION public.require_actual_supplier_payment_before_financing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  IF NEW.payment_source_type IS NOT NULL
     AND OLD.payment_source_type IS NULL
     AND (NEW.actual_amount_eur IS NULL OR NEW.actual_amount_eur <= 0) THEN
    RAISE EXCEPTION 'UNVERIFIED_ACTUAL_AMOUNT: real EUR amount is required before financing'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_require_actual_supplier_payment_before_financing
  ON public.finance_supplier_payments;
CREATE TRIGGER trg_require_actual_supplier_payment_before_financing
BEFORE UPDATE OF payment_source_type
ON public.finance_supplier_payments
FOR EACH ROW
EXECUTE FUNCTION public.require_actual_supplier_payment_before_financing();

REVOKE EXECUTE ON FUNCTION public.mark_supplier_payment_paid(
  uuid, uuid, timestamptz, numeric, numeric, text, text, numeric, numeric, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.mark_supplier_payment_paid(
  uuid, uuid, timestamptz, numeric, numeric, text, text, numeric, numeric, text
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.require_actual_supplier_payment_before_financing()
FROM PUBLIC;

COMMIT;
