BEGIN;

CREATE OR REPLACE FUNCTION public.confirm_order_with_effective_date(
  p_order_id uuid,
  p_confirmation_date date,
  p_eta date,
  p_etd date DEFAULT NULL,
  p_eta_real date DEFAULT NULL,
  p_lead_time_produccion integer DEFAULT NULL,
  p_lead_time_transito integer DEFAULT NULL,
  p_numero_pedido_agente text DEFAULT NULL,
  p_agente_id uuid DEFAULT NULL,
  p_moneda_compra text DEFAULT NULL,
  p_tipo_cambio_moneda_eur numeric DEFAULT NULL,
  p_tipo_cambio_usd_eur numeric DEFAULT NULL,
  p_deposito_porcentaje numeric DEFAULT 30,
  p_balance_dias_antes_eta integer DEFAULT 10,
  p_balance_condiciones_texto text DEFAULT 'The balance will be paid 10 days before the vessel arrives at the port',
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS public.ordenes_compra
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_order public.ordenes_compra;
  v_effective_etd date;
  v_effective_eta date;
  v_confirmed public.ordenes_compra;
BEGIN
  IF p_confirmation_date IS NULL THEN
    RAISE EXCEPTION 'CONFIRMATION_DATE_REQUIRED: confirmation date is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO STRICT v_order
  FROM public.ordenes_compra
  WHERE id = p_order_id
  FOR UPDATE;

  -- Los valores explícitos son fuente de verdad. Solo los NULL se calculan.
  v_effective_etd := coalesce(
    p_etd,
    v_order.fecha_orden + coalesce(p_lead_time_produccion, v_order.lead_time_produccion, 0)
  );
  v_effective_eta := coalesce(
    p_eta,
    v_effective_etd + coalesce(p_lead_time_transito, v_order.lead_time_transito, 0)
  );

  v_confirmed := public.confirm_order_with_current_factory_costs(
    p_order_id, v_effective_eta, v_effective_etd, p_eta_real,
    p_lead_time_produccion, p_lead_time_transito,
    p_numero_pedido_agente, p_agente_id, p_moneda_compra,
    p_tipo_cambio_moneda_eur, p_tipo_cambio_usd_eur,
    p_deposito_porcentaje, p_balance_dias_antes_eta,
    p_balance_condiciones_texto, p_items
  );

  UPDATE public.ordenes_compra
  SET fecha_confirmacion = p_confirmation_date
  WHERE id = p_order_id
    AND fecha_confirmacion IS DISTINCT FROM p_confirmation_date
  RETURNING * INTO v_confirmed;

  IF v_confirmed.id IS NULL THEN
    SELECT * INTO STRICT v_confirmed
    FROM public.ordenes_compra
    WHERE id = p_order_id;
  END IF;

  RETURN v_confirmed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_order_with_effective_date(
  uuid,date,date,date,date,integer,integer,text,uuid,text,numeric,numeric,numeric,integer,text,jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_order_with_effective_date(
  uuid,date,date,date,date,integer,integer,text,uuid,text,numeric,numeric,numeric,integer,text,jsonb
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_supplier_payment_plan_protected(
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
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payment public.finance_supplier_payments;
BEGIN
  IF NOT public.finance_can_read_unlinked_details() THEN
    RAISE EXCEPTION 'ADMIN_OR_ACCOUNTING_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_payment
  FROM public.finance_supplier_payments
  WHERE orden_id = p_order_id
    AND payment_type = p_payment_type
  FOR UPDATE;

  IF FOUND AND (
    v_payment.status IN ('pagado', 'parcial')
    OR v_payment.paid_at IS NOT NULL
    OR v_payment.actual_amount_original IS NOT NULL
    OR v_payment.actual_amount_eur IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM public.finance_purchase_payment_allocations allocation
      WHERE allocation.supplier_payment_id = v_payment.id
    )
  ) THEN
    RETURN v_payment;
  END IF;

  RETURN public.sync_supplier_payment_plan(
    p_order_id, p_payment_type, p_due_date, p_amount_original,
    p_original_currency, p_planned_fx_rate, p_amount_eur,
    p_logistics_type, p_container_id, p_status, p_notes, p_update_notes
  );
END;
$$;

ALTER FUNCTION public.confirm_order_with_effective_date(
  uuid,date,date,date,date,integer,integer,text,uuid,text,numeric,numeric,numeric,integer,text,jsonb
) OWNER TO postgres;
ALTER FUNCTION public.sync_supplier_payment_plan_protected(
  uuid,text,date,numeric,text,numeric,numeric,text,uuid,text,text,boolean
) OWNER TO postgres;

REVOKE EXECUTE ON FUNCTION public.sync_supplier_payment_plan_protected(
  uuid,text,date,numeric,text,numeric,numeric,text,uuid,text,text,boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_supplier_payment_plan_protected(
  uuid,text,date,numeric,text,numeric,numeric,text,uuid,text,text,boolean
) TO authenticated, service_role;

COMMIT;
