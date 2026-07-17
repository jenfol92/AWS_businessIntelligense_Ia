-- Fase 1 costes: confirmacion transaccional de orden + coste vigente.
-- No aplicar hasta revisar junto con la UI/API de confirmacion.

CREATE OR REPLACE FUNCTION public.confirm_order_with_current_factory_costs(
  p_order_id uuid,
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
AS $$
DECLARE
  v_order public.ordenes_compra;
  v_moneda text;
  v_expected_count integer;
  v_input_count integer;
  v_distinct_input_count integer;
  v_confirmed public.ordenes_compra;
BEGIN
  SELECT *
  INTO v_order
  FROM public.ordenes_compra
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada: %', p_order_id USING ERRCODE = 'P0002';
  END IF;

  IF v_order.estado = 'confirmado' THEN
    RETURN v_order;
  END IF;

  IF v_order.estado <> 'borrador' THEN
    RAISE EXCEPTION 'No se puede confirmar una orden en estado %', v_order.estado
      USING ERRCODE = '22023';
  END IF;

  v_moneda := upper(trim(coalesce(p_moneda_compra, v_order.moneda_compra, '')));
  IF v_moneda NOT IN ('USD', 'EUR', 'GBP', 'CNY') THEN
    RAISE EXCEPTION 'Moneda de coste no valida: %', coalesce(p_moneda_compra, v_order.moneda_compra, '(null)')
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)
  INTO v_expected_count
  FROM public.orden_items
  WHERE orden_id = p_order_id;

  SELECT count(*), count(DISTINCT item_id)
  INTO v_input_count, v_distinct_input_count
  FROM jsonb_to_recordset(p_items) AS item(
    item_id uuid,
    coste_unitario_moneda numeric,
    coste_unitario_usd numeric,
    coste_unitario_eur numeric,
    lote_producto text
  );

  IF v_expected_count = 0
    OR v_input_count <> v_expected_count
    OR v_distinct_input_count <> v_expected_count THEN
    RAISE EXCEPTION 'La confirmacion no cubre exactamente todas las lineas de la orden'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS item(
      item_id uuid,
      coste_unitario_moneda numeric,
      coste_unitario_usd numeric,
      coste_unitario_eur numeric,
      lote_producto text
    )
    GROUP BY item.item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay lineas repetidas en la confirmacion'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS item(
      item_id uuid,
      coste_unitario_moneda numeric,
      coste_unitario_usd numeric,
      coste_unitario_eur numeric,
      lote_producto text
    )
    JOIN public.orden_items oi
      ON oi.id = item.item_id
     AND oi.orden_id = p_order_id
    GROUP BY oi.producto_id
    HAVING count(DISTINCT item.coste_unitario_moneda) > 1
  ) THEN
    RAISE EXCEPTION 'Una misma orden contiene el mismo producto con costes distintos'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS item(
      item_id uuid,
      coste_unitario_moneda numeric,
      coste_unitario_usd numeric,
      coste_unitario_eur numeric,
      lote_producto text
    )
    LEFT JOIN public.orden_items oi
      ON oi.id = item.item_id
     AND oi.orden_id = p_order_id
    WHERE oi.id IS NULL
       OR oi.producto_id IS NULL
       OR item.coste_unitario_moneda IS NULL
       OR item.coste_unitario_moneda <= 0
  ) THEN
    RAISE EXCEPTION 'Hay lineas ajenas, sin producto o sin coste valido'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.orden_items oi
    WHERE oi.orden_id = p_order_id
      AND oi.producto_id IS NOT NULL
    GROUP BY oi.producto_id
    HAVING count(DISTINCT oi.proveedor_id) FILTER (WHERE oi.proveedor_id IS NOT NULL) > 1
  ) THEN
    RAISE EXCEPTION 'Una misma orden contiene el mismo producto con proveedores distintos'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.orden_items oi
  SET
    coste_unitario_moneda = item.coste_unitario_moneda,
    coste_unitario_usd = item.coste_unitario_usd,
    coste_unitario_eur = item.coste_unitario_eur,
    lote_producto = nullif(item.lote_producto, '')
  FROM jsonb_to_recordset(p_items) AS item(
    item_id uuid,
    coste_unitario_moneda numeric,
    coste_unitario_usd numeric,
    coste_unitario_eur numeric,
    lote_producto text
  )
  WHERE oi.id = item.item_id
    AND oi.orden_id = p_order_id;

  PERFORM public.upsert_current_factory_cost_by_currency(
    grouped.producto_id,
    v_moneda,
    grouped.coste_unitario_moneda,
    grouped.proveedor_id,
    NULL,
    CURRENT_DATE
  )
  FROM (
    SELECT
      oi.producto_id,
      (array_agg(DISTINCT oi.proveedor_id) FILTER (WHERE oi.proveedor_id IS NOT NULL))[1] AS proveedor_id,
      oi.coste_unitario_moneda
    FROM public.orden_items oi
    WHERE oi.orden_id = p_order_id
    GROUP BY oi.producto_id, oi.coste_unitario_moneda
  ) grouped;

  UPDATE public.ordenes_compra
  SET
    estado = 'confirmado',
    fecha_confirmacion = CURRENT_DATE,
    eta = p_eta,
    etd = p_etd,
    eta_real = p_eta_real,
    lead_time_produccion = p_lead_time_produccion,
    lead_time_transito = p_lead_time_transito,
    numero_pedido_agente = p_numero_pedido_agente,
    agente_id = p_agente_id,
    moneda_compra = v_moneda,
    tipo_cambio_moneda_eur = p_tipo_cambio_moneda_eur,
    tipo_cambio_usd_eur = p_tipo_cambio_usd_eur,
    deposito_porcentaje = coalesce(p_deposito_porcentaje, 30),
    balance_dias_antes_eta = coalesce(p_balance_dias_antes_eta, 10),
    balance_condiciones_texto = coalesce(
      p_balance_condiciones_texto,
      'The balance will be paid 10 days before the vessel arrives at the port'
    )
  WHERE id = p_order_id
    AND estado = 'borrador'
  RETURNING * INTO v_confirmed;

  IF v_confirmed.id IS NULL THEN
    RAISE EXCEPTION 'No se pudo confirmar la cabecera de la orden'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_confirmed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.confirm_order_with_current_factory_costs(
  uuid,
  date,
  date,
  date,
  integer,
  integer,
  text,
  uuid,
  text,
  numeric,
  numeric,
  numeric,
  integer,
  text,
  jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.confirm_order_with_current_factory_costs(
  uuid,
  date,
  date,
  date,
  integer,
  integer,
  text,
  uuid,
  text,
  numeric,
  numeric,
  numeric,
  integer,
  text,
  jsonb
) TO authenticated, service_role;
