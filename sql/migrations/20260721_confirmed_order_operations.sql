-- Edición exclusivamente operativa de órdenes confirmadas.
-- No modifica líneas, costes de producto, condiciones comerciales ni proformas.

BEGIN;

CREATE OR REPLACE FUNCTION public.update_confirmed_purchase_order_operations(
  p_order_id uuid,
  p_patch jsonb DEFAULT '{}'::jsonb
)
RETURNS public.ordenes_compra
LANGUAGE plpgsql
AS $$
DECLARE
  v_order public.ordenes_compra;
  v_updated public.ordenes_compra;
  v_changed_schedule boolean;
  v_changed_shipping boolean;
  v_changed_fx boolean;
  v_balance_due date;
  v_balance_days integer;
  v_fx numeric;
BEGIN
  IF jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'El patch operativo debe ser un objeto JSON.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_order
  FROM public.ordenes_compra
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada: %', p_order_id USING ERRCODE = 'P0002';
  END IF;

  IF v_order.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'Solo se pueden editar operativamente órdenes confirmadas.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) AS key(name)
    WHERE key.name NOT IN (
      'destino',
      'tipo_envio',
      'etd',
      'eta',
      'eta_real',
      'lead_time_produccion',
      'lead_time_transito',
      'agente_id',
      'numero_pedido_agente',
      'notas',
      'tipo_cambio_moneda_eur'
    )
  ) THEN
    RAISE EXCEPTION 'La edición operativa contiene campos no permitidos.'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'tipo_envio'
     AND coalesce(p_patch->>'tipo_envio', '') NOT IN ('propio', 'amazon_agl') THEN
    RAISE EXCEPTION 'tipo_envio no válido.'
      USING ERRCODE = '22023';
  END IF;

  IF p_patch ? 'tipo_cambio_moneda_eur'
     AND (
       (p_patch->>'tipo_cambio_moneda_eur') IS NULL
       OR (p_patch->>'tipo_cambio_moneda_eur')::numeric <= 0
     ) THEN
    RAISE EXCEPTION 'tipo_cambio_moneda_eur debe ser positivo.'
      USING ERRCODE = '22023';
  END IF;

  v_changed_shipping :=
    p_patch ? 'tipo_envio'
    AND (p_patch->>'tipo_envio') IS DISTINCT FROM v_order.tipo_envio;

  IF v_changed_shipping AND p_patch->>'tipo_envio' = 'amazon_agl' AND (
    EXISTS (
      SELECT 1
      FROM public.contenedor_ordenes co
      WHERE co.orden_id = p_order_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.orden_logistics_assignments ola
      WHERE ola.orden_id = p_order_id
        AND ola.assignment_type = 'contenedor_propio'
        AND ola.status = 'active'
    )
  ) THEN
    RAISE EXCEPTION 'La orden tiene un contenedor propio activo. Desvincúlalo antes de cambiar a Amazon AGL.'
      USING ERRCODE = '22023';
  END IF;

  IF v_changed_shipping AND p_patch->>'tipo_envio' = 'propio' AND EXISTS (
    SELECT 1
    FROM public.orden_logistics_assignments ola
    WHERE ola.orden_id = p_order_id
      AND ola.assignment_type = 'amazon_inbound'
      AND ola.status = 'active'
  ) THEN
    RAISE EXCEPTION 'La orden tiene un envío Amazon inbound activo. Desvincúlalo antes de cambiar a contenedor propio.'
      USING ERRCODE = '22023';
  END IF;

  v_changed_schedule :=
    (p_patch ? 'etd' AND (p_patch->>'etd') IS DISTINCT FROM v_order.etd::text)
    OR (p_patch ? 'eta' AND (p_patch->>'eta') IS DISTINCT FROM v_order.eta::text)
    OR (p_patch ? 'eta_real' AND (p_patch->>'eta_real') IS DISTINCT FROM v_order.eta_real::text);

  v_changed_fx :=
    p_patch ? 'tipo_cambio_moneda_eur'
    AND (p_patch->>'tipo_cambio_moneda_eur')::numeric
      IS DISTINCT FROM v_order.tipo_cambio_moneda_eur;

  UPDATE public.ordenes_compra oc
  SET
    destino = CASE WHEN p_patch ? 'destino' THEN nullif(p_patch->>'destino', '') ELSE oc.destino END,
    tipo_envio = CASE WHEN p_patch ? 'tipo_envio' THEN p_patch->>'tipo_envio' ELSE oc.tipo_envio END,
    etd = CASE WHEN p_patch ? 'etd' THEN nullif(p_patch->>'etd', '')::date ELSE oc.etd END,
    eta = CASE WHEN p_patch ? 'eta' THEN nullif(p_patch->>'eta', '')::date ELSE oc.eta END,
    eta_real = CASE WHEN p_patch ? 'eta_real' THEN nullif(p_patch->>'eta_real', '')::date ELSE oc.eta_real END,
    lead_time_produccion = CASE
      WHEN p_patch ? 'lead_time_produccion'
        THEN nullif(p_patch->>'lead_time_produccion', '')::integer
      ELSE oc.lead_time_produccion
    END,
    lead_time_transito = CASE
      WHEN p_patch ? 'lead_time_transito'
        THEN nullif(p_patch->>'lead_time_transito', '')::integer
      ELSE oc.lead_time_transito
    END,
    agente_id = CASE WHEN p_patch ? 'agente_id' THEN nullif(p_patch->>'agente_id', '')::uuid ELSE oc.agente_id END,
    numero_pedido_agente = CASE
      WHEN p_patch ? 'numero_pedido_agente' THEN nullif(p_patch->>'numero_pedido_agente', '')
      ELSE oc.numero_pedido_agente
    END,
    notas = CASE WHEN p_patch ? 'notas' THEN p_patch->>'notas' ELSE oc.notas END,
    tipo_cambio_moneda_eur = CASE
      WHEN p_patch ? 'tipo_cambio_moneda_eur'
        THEN (p_patch->>'tipo_cambio_moneda_eur')::numeric
      ELSE oc.tipo_cambio_moneda_eur
    END,
    updated_at = now()
  WHERE oc.id = p_order_id
    AND oc.estado = 'confirmado'
  RETURNING * INTO v_updated;

  IF v_updated.id IS NULL THEN
    RAISE EXCEPTION 'No se pudo actualizar la orden confirmada.' USING ERRCODE = 'P0001';
  END IF;

  IF v_changed_fx THEN
    v_fx := CASE
      WHEN upper(coalesce(v_updated.moneda_compra, '')) = 'EUR' THEN 1
      ELSE v_updated.tipo_cambio_moneda_eur
    END;

    UPDATE public.ordenes_compra
    SET coste_total_eur = coalesce((
      SELECT sum(coalesce(oi.coste_unitario_moneda, 0) * oi.cantidad * v_fx)
      FROM public.orden_items oi
      WHERE oi.orden_id = p_order_id
    ), 0)
    WHERE id = p_order_id
    RETURNING * INTO v_updated;

    UPDATE public.finance_supplier_payments fsp
    SET
      planned_fx_rate = v_fx,
      amount_eur = fsp.amount_original * v_fx,
      updated_at = now()
    WHERE fsp.orden_id = p_order_id
      AND fsp.status IN ('pendiente', 'vencido');
  END IF;

  IF v_changed_schedule OR v_changed_shipping THEN
    v_balance_days := greatest(0, coalesce(v_updated.balance_dias_antes_eta, 10));
    v_balance_due := CASE
      WHEN v_updated.tipo_envio = 'amazon_agl' THEN v_updated.etd::date
      ELSE coalesce(v_updated.eta_real::date, v_updated.eta::date) - v_balance_days
    END;

    UPDATE public.finance_supplier_payments fsp
    SET
      due_date = v_balance_due,
      updated_at = now()
    WHERE fsp.orden_id = p_order_id
      AND fsp.payment_type = 'BALANCE_70'
      AND fsp.status IN ('pendiente', 'vencido');

    IF v_changed_shipping THEN
      UPDATE public.finance_supplier_payments fsp
      SET
        logistics_type = v_updated.tipo_envio,
        updated_at = now()
      WHERE fsp.orden_id = p_order_id
        AND fsp.status IN ('pendiente', 'vencido');
    END IF;
  END IF;

  SELECT *
  INTO v_updated
  FROM public.ordenes_compra
  WHERE id = p_order_id;

  RETURN v_updated;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_confirmed_purchase_order_operations(uuid, jsonb)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_confirmed_purchase_order_operations(uuid, jsonb)
TO authenticated, service_role;

COMMIT;
