-- Ordenes confirmadas: reapertura y edicion de costes transaccionales.
-- No aplicar en produccion sin ejecutar primero en base de pruebas.

CREATE OR REPLACE FUNCTION public.reopen_confirmed_purchase_order(
  p_order_id uuid
)
RETURNS public.ordenes_compra
LANGUAGE plpgsql
AS $$
DECLARE
  v_order public.ordenes_compra;
  v_reopened public.ordenes_compra;
BEGIN
  SELECT *
  INTO v_order
  FROM public.ordenes_compra
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada: %', p_order_id USING ERRCODE = 'P0002';
  END IF;

  IF v_order.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'Solo se pueden reabrir ordenes confirmadas.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.finance_supplier_payments fsp
    WHERE fsp.orden_id = p_order_id
      AND fsp.status = 'pagado'
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'No se puede reabrir la orden porque tiene pagos realizados.'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.finance_supplier_payments fsp
  WHERE fsp.orden_id = p_order_id
    AND fsp.status IN ('pendiente', 'vencido');

  UPDATE public.ordenes_compra
  SET
    estado = 'borrador',
    updated_at = now()
  WHERE id = p_order_id
    AND estado = 'confirmado'
  RETURNING * INTO v_reopened;

  IF v_reopened.id IS NULL THEN
    RAISE EXCEPTION 'No se pudo reabrir la orden.' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_reopened;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reopen_confirmed_purchase_order(uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reopen_confirmed_purchase_order(uuid)
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_confirmed_purchase_order_costs(
  p_order_id uuid,
  p_items jsonb
)
RETURNS public.ordenes_compra
LANGUAGE plpgsql
AS $$
DECLARE
  v_order public.ordenes_compra;
  v_updated public.ordenes_compra;
  v_input_count integer;
  v_distinct_input_count integer;
  v_currency text;
BEGIN
  SELECT *
  INTO v_order
  FROM public.ordenes_compra
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada: %', p_order_id USING ERRCODE = 'P0002';
  END IF;

  IF v_order.estado <> 'confirmado' THEN
    RAISE EXCEPTION 'Solo se pueden editar costes de ordenes confirmadas abiertas.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.finance_supplier_payments fsp
    WHERE fsp.orden_id = p_order_id
      AND fsp.status = 'pagado'
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'No se puede modificar el coste porque la orden tiene pagos realizados.'
      USING ERRCODE = '22023';
  END IF;

  v_currency := upper(trim(coalesce(v_order.moneda_compra, '')));
  IF v_currency NOT IN ('USD', 'EUR', 'GBP', 'CNY') THEN
    RAISE EXCEPTION 'Moneda de compra no valida para actualizar costes: %', coalesce(v_order.moneda_compra, '(null)')
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*), count(DISTINCT item_id)
  INTO v_input_count, v_distinct_input_count
  FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS item(
    item_id uuid,
    coste_unitario_moneda numeric,
    coste_unitario_usd numeric,
    coste_unitario_eur numeric
  );

  IF v_input_count = 0 THEN
    RETURN v_order;
  END IF;

  IF v_input_count <> v_distinct_input_count THEN
    RAISE EXCEPTION 'Hay lineas repetidas en la edicion de costes.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS item(
      item_id uuid,
      coste_unitario_moneda numeric,
      coste_unitario_usd numeric,
      coste_unitario_eur numeric
    )
    LEFT JOIN public.orden_items oi
      ON oi.id = item.item_id
     AND oi.orden_id = p_order_id
    WHERE oi.id IS NULL
       OR oi.producto_id IS NULL
       OR item.coste_unitario_moneda IS NULL
       OR item.coste_unitario_moneda <= 0
  ) THEN
    RAISE EXCEPTION 'Hay lineas ajenas, sin producto o sin coste valido.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS item(
      item_id uuid,
      coste_unitario_moneda numeric,
      coste_unitario_usd numeric,
      coste_unitario_eur numeric
    )
    JOIN public.orden_items oi
      ON oi.id = item.item_id
     AND oi.orden_id = p_order_id
    JOIN public.producto_costos pc
      ON pc.producto_id = oi.producto_id
     AND pc.contenedor_id IS NOT NULL
     AND coalesce(pc.lote_producto, '') = coalesce(oi.lote_producto, '')
  ) THEN
    RAISE EXCEPTION 'No se puede modificar el coste porque la linea ya tiene coste facturado o lote definitivo.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.orden_items oi
  JOIN jsonb_to_recordset(p_items) AS item(
    item_id uuid,
    coste_unitario_moneda numeric,
    coste_unitario_usd numeric,
    coste_unitario_eur numeric
  )
    ON item.item_id = oi.id
  WHERE oi.orden_id = p_order_id
  FOR UPDATE OF oi;

  UPDATE public.orden_items oi
  SET
    coste_unitario_moneda = item.coste_unitario_moneda,
    coste_unitario_usd = coalesce(item.coste_unitario_usd, oi.coste_unitario_usd),
    coste_unitario_eur = coalesce(item.coste_unitario_eur, oi.coste_unitario_eur)
  FROM jsonb_to_recordset(p_items) AS item(
    item_id uuid,
    coste_unitario_moneda numeric,
    coste_unitario_usd numeric,
    coste_unitario_eur numeric
  )
  WHERE oi.id = item.item_id
    AND oi.orden_id = p_order_id;

  IF EXISTS (
    SELECT 1
    FROM public.orden_items oi
    JOIN jsonb_to_recordset(p_items) AS item(
      item_id uuid,
      coste_unitario_moneda numeric,
      coste_unitario_usd numeric,
      coste_unitario_eur numeric
    )
      ON item.item_id = oi.id
    WHERE oi.orden_id = p_order_id
    GROUP BY oi.producto_id
    HAVING count(DISTINCT oi.coste_unitario_moneda) > 1
  ) THEN
    RAISE EXCEPTION 'Una misma orden contiene el mismo producto con costes distintos.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.upsert_current_factory_cost_by_currency(
    grouped.producto_id,
    v_currency,
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
    JOIN jsonb_to_recordset(p_items) AS item(
      item_id uuid,
      coste_unitario_moneda numeric,
      coste_unitario_usd numeric,
      coste_unitario_eur numeric
    )
      ON item.item_id = oi.id
    WHERE oi.orden_id = p_order_id
    GROUP BY oi.producto_id, oi.coste_unitario_moneda
  ) grouped;

  DELETE FROM public.finance_supplier_payments fsp
  WHERE fsp.orden_id = p_order_id
    AND fsp.status IN ('pendiente', 'vencido');

  SELECT *
  INTO v_updated
  FROM public.ordenes_compra
  WHERE id = p_order_id;

  RETURN v_updated;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_confirmed_purchase_order_costs(uuid, jsonb)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_confirmed_purchase_order_costs(uuid, jsonb)
TO authenticated, service_role;
