-- Sincroniza exclusivamente la planificación de un pago proveedor.
-- La exclusión mutua por fila impide sobrescribir una ejecución bancaria concurrente.

BEGIN;

CREATE OR REPLACE FUNCTION public.sync_supplier_payment_plan(
  p_order_id uuid,
  p_payment_type text,
  p_due_date date,
  p_amount_original numeric,
  p_original_currency text,
  p_planned_fx_rate numeric,
  p_amount_eur numeric,
  p_logistics_type text,
  p_container_id uuid,
  p_status text,
  p_notes text DEFAULT NULL,
  p_update_notes boolean DEFAULT false
)
RETURNS public.finance_supplier_payments
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payment public.finance_supplier_payments;
  v_currency text;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ORDER_ID: order_id is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_payment_type IS NULL
     OR p_payment_type NOT IN ('DEPOSITO_30', 'BALANCE_70') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_TYPE: payment_type must be DEPOSITO_30 or BALANCE_70'
      USING ERRCODE = '22023';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('pendiente', 'vencido') THEN
    RAISE EXCEPTION 'INVALID_PLAN_STATUS: status must be pendiente or vencido'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount_original IS NULL
     OR p_amount_original <= 0
     OR p_amount_original::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'INVALID_ORIGINAL_AMOUNT: amount_original must be finite and positive'
      USING ERRCODE = '22023';
  END IF;

  v_currency := upper(trim(coalesce(p_original_currency, '')));
  IF v_currency = '' THEN
    RAISE EXCEPTION 'INVALID_ORIGINAL_CURRENCY: original_currency is required'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount_eur IS NULL
     OR p_amount_eur < 0
     OR p_amount_eur::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'INVALID_PLANNED_AMOUNT_EUR: amount_eur must be finite and nonnegative'
      USING ERRCODE = '22023';
  END IF;

  IF p_planned_fx_rate IS NOT NULL
     AND (
       p_planned_fx_rate <= 0
       OR p_planned_fx_rate::text IN ('NaN', 'Infinity', '-Infinity')
     ) THEN
    RAISE EXCEPTION 'INVALID_PLANNED_FX_RATE: planned_fx_rate must be finite and positive'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.finance_supplier_payments (
    orden_id,
    payment_type,
    due_date,
    amount_original,
    original_currency,
    planned_fx_rate,
    amount_eur,
    logistics_type,
    contenedor_id,
    status,
    notes
  )
  VALUES (
    p_order_id,
    p_payment_type,
    p_due_date,
    p_amount_original,
    v_currency,
    p_planned_fx_rate,
    p_amount_eur,
    p_logistics_type,
    p_container_id,
    p_status,
    p_notes
  )
  ON CONFLICT (orden_id, payment_type) DO NOTHING;

  SELECT *
  INTO v_payment
  FROM public.finance_supplier_payments
  WHERE orden_id = p_order_id
    AND payment_type = p_payment_type
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_PAYMENT_NOT_FOUND: payment row was not created'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_payment.status = 'pagado' THEN
    RETURN v_payment;
  END IF;

  IF v_payment.status NOT IN ('pendiente', 'vencido') THEN
    RAISE EXCEPTION 'INVALID_EXISTING_PLAN_STATUS: payment status cannot be synchronized'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.finance_supplier_payments
  SET
    due_date = p_due_date,
    amount_original = p_amount_original,
    original_currency = v_currency,
    planned_fx_rate = p_planned_fx_rate,
    amount_eur = p_amount_eur,
    logistics_type = p_logistics_type,
    contenedor_id = p_container_id,
    status = p_status,
    notes = CASE WHEN p_update_notes THEN p_notes ELSE notes END,
    updated_at = now()
  WHERE id = v_payment.id
  RETURNING * INTO v_payment;

  RETURN v_payment;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_supplier_payment_plan(
  uuid, text, date, numeric, text, numeric, numeric, text, uuid, text, text, boolean
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.sync_supplier_payment_plan(
  uuid, text, date, numeric, text, numeric, numeric, text, uuid, text, text, boolean
) TO authenticated, service_role;

COMMIT;
