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

CREATE OR REPLACE FUNCTION public.update_confirmed_purchase_order(
  p_order_id uuid,
  p_header jsonb DEFAULT '{}'::jsonb,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS public.ordenes_compra
LANGUAGE plpgsql
AS $$
DECLARE
  v_order public.ordenes_compra;
  v_updated public.ordenes_compra;
  v_changed_cost_count integer := 0;
  v_changed_eta boolean := false;
  v_changed_payments boolean := false;
  v_currency text;
  v_deposit_pct numeric;
  v_balance_pct numeric;
  v_base_original numeric;
  v_base_eur numeric;
  v_planned_fx numeric;
  v_deposit_due date;
  v_balance_due date;
  v_balance_days integer;
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
    RAISE EXCEPTION 'Solo se pueden editar ordenes confirmadas abiertas.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(coalesce(p_header, '{}'::jsonb)) AS key(name)
    WHERE key.name NOT IN (
      'tipo_envio',
      'fob_puerto',
      'destino',
      'etd',
      'eta',
      'eta_real',
      'lead_time_produccion',
      'lead_time_transito',
      'agente_id',
      'numero_pedido_agente',
      'notas'
    )
  ) THEN
    RAISE EXCEPTION 'La edicion confirmada contiene campos de cabecera no permitidos.'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*)
  INTO v_changed_cost_count
  FROM jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) AS item(
    item_id uuid,
    coste_unitario_moneda numeric,
    coste_unitario_usd numeric,
    coste_unitario_eur numeric
  )
  JOIN public.orden_items oi
    ON oi.id = item.item_id
   AND oi.orden_id = p_order_id
  WHERE item.coste_unitario_moneda IS DISTINCT FROM oi.coste_unitario_moneda
     OR item.coste_unitario_usd IS DISTINCT FROM oi.coste_unitario_usd
     OR item.coste_unitario_eur IS DISTINCT FROM oi.coste_unitario_eur;

  v_changed_eta :=
    (p_header ? 'eta' AND (p_header->>'eta') IS DISTINCT FROM v_order.eta::text)
    OR (p_header ? 'eta_real' AND (p_header->>'eta_real') IS DISTINCT FROM v_order.eta_real::text)
    OR (p_header ? 'etd' AND (p_header->>'etd') IS DISTINCT FROM v_order.etd::text);

  v_changed_payments := v_changed_eta OR v_changed_cost_count > 0;

  IF v_changed_cost_count > 0
     AND EXISTS (
       SELECT 1
       FROM public.finance_supplier_payments fsp
       WHERE fsp.orden_id = p_order_id
         AND fsp.status = 'pagado'
       FOR UPDATE
     ) THEN
    RAISE EXCEPTION 'No se puede modificar el coste porque la orden tiene pagos realizados.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.ordenes_compra oc
  SET
    tipo_envio = CASE WHEN p_header ? 'tipo_envio' THEN p_header->>'tipo_envio' ELSE oc.tipo_envio END,
    fob_puerto = CASE WHEN p_header ? 'fob_puerto' THEN nullif(p_header->>'fob_puerto', '') ELSE oc.fob_puerto END,
    destino = CASE WHEN p_header ? 'destino' THEN nullif(p_header->>'destino', '') ELSE oc.destino END,
    etd = CASE WHEN p_header ? 'etd' THEN nullif(p_header->>'etd', '')::date ELSE oc.etd END,
    eta = CASE WHEN p_header ? 'eta' THEN nullif(p_header->>'eta', '')::date ELSE oc.eta END,
    eta_real = CASE WHEN p_header ? 'eta_real' THEN nullif(p_header->>'eta_real', '')::date ELSE oc.eta_real END,
    lead_time_produccion = CASE WHEN p_header ? 'lead_time_produccion' THEN (p_header->>'lead_time_produccion')::integer ELSE oc.lead_time_produccion END,
    lead_time_transito = CASE WHEN p_header ? 'lead_time_transito' THEN (p_header->>'lead_time_transito')::integer ELSE oc.lead_time_transito END,
    agente_id = CASE WHEN p_header ? 'agente_id' THEN nullif(p_header->>'agente_id', '')::uuid ELSE oc.agente_id END,
    numero_pedido_agente = CASE WHEN p_header ? 'numero_pedido_agente' THEN nullif(p_header->>'numero_pedido_agente', '') ELSE oc.numero_pedido_agente END,
    notas = CASE WHEN p_header ? 'notas' THEN p_header->>'notas' ELSE oc.notas END,
    updated_at = now()
  WHERE oc.id = p_order_id
    AND oc.estado = 'confirmado'
  RETURNING * INTO v_updated;

  IF v_updated.id IS NULL THEN
    RAISE EXCEPTION 'No se pudo actualizar la orden confirmada.' USING ERRCODE = 'P0001';
  END IF;

  IF p_header ? 'tipo_envio' AND p_header->>'tipo_envio' = 'amazon_agl' THEN
    DELETE FROM public.contenedor_ordenes
    WHERE orden_id = p_order_id;

    UPDATE public.orden_logistics_assignments
    SET status = 'inactive'
    WHERE orden_id = p_order_id
      AND assignment_type = 'contenedor_propio'
      AND status = 'active';
  ELSIF p_header ? 'tipo_envio' AND p_header->>'tipo_envio' = 'propio' THEN
    UPDATE public.orden_logistics_assignments
    SET status = 'inactive'
    WHERE orden_id = p_order_id
      AND assignment_type = 'amazon_inbound'
      AND status = 'active';
  END IF;

  IF v_changed_cost_count > 0 THEN
    v_currency := upper(trim(coalesce(v_updated.moneda_compra, '')));
    IF v_currency NOT IN ('USD', 'EUR', 'GBP', 'CNY') THEN
      RAISE EXCEPTION 'Moneda de compra no valida para actualizar costes: %', coalesce(v_updated.moneda_compra, '(null)')
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
      AND (
        item.coste_unitario_moneda IS DISTINCT FROM oi.coste_unitario_moneda
        OR item.coste_unitario_usd IS DISTINCT FROM oi.coste_unitario_usd
        OR item.coste_unitario_eur IS DISTINCT FROM oi.coste_unitario_eur
      )
    FOR UPDATE OF oi;

    UPDATE public.orden_items oi
    SET
      coste_unitario_moneda = item.coste_unitario_moneda,
      coste_unitario_usd = item.coste_unitario_usd,
      coste_unitario_eur = item.coste_unitario_eur
    FROM jsonb_to_recordset(p_items) AS item(
      item_id uuid,
      coste_unitario_moneda numeric,
      coste_unitario_usd numeric,
      coste_unitario_eur numeric
    )
    WHERE oi.id = item.item_id
      AND oi.orden_id = p_order_id
      AND (
        item.coste_unitario_moneda IS DISTINCT FROM oi.coste_unitario_moneda
        OR item.coste_unitario_usd IS DISTINCT FROM oi.coste_unitario_usd
        OR item.coste_unitario_eur IS DISTINCT FROM oi.coste_unitario_eur
      );

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
  END IF;

  IF v_changed_payments THEN
    SELECT *
    INTO v_updated
    FROM public.ordenes_compra
    WHERE id = p_order_id;

    v_currency := upper(trim(coalesce(v_updated.moneda_compra, 'USD')));
    v_deposit_pct := coalesce(v_updated.deposito_porcentaje, 30);
    v_balance_pct := greatest(0, 100 - v_deposit_pct);
    v_balance_days := greatest(0, coalesce(v_updated.balance_dias_antes_eta, 10));
    v_deposit_due := coalesce(v_updated.fecha_confirmacion::date, v_updated.fecha_orden::date);
    v_balance_due := CASE
      WHEN v_updated.tipo_envio = 'amazon_agl'
        THEN v_updated.etd::date
      ELSE coalesce(v_updated.eta_real::date, v_updated.eta::date) - v_balance_days
    END;

    SELECT coalesce(sum(coalesce(oi.coste_unitario_moneda, 0) * coalesce(oi.cantidad, 0)), 0)
    INTO v_base_original
    FROM public.orden_items oi
    WHERE oi.orden_id = p_order_id;

    v_planned_fx := CASE
      WHEN v_currency = 'EUR' THEN 1
      WHEN v_updated.tipo_cambio_moneda_eur IS NOT NULL AND v_updated.tipo_cambio_moneda_eur > 0
        THEN v_updated.tipo_cambio_moneda_eur
      WHEN v_currency = 'USD' AND v_updated.tipo_cambio_usd_eur IS NOT NULL AND v_updated.tipo_cambio_usd_eur > 0
        THEN v_updated.tipo_cambio_usd_eur
      ELSE NULL
    END;
    v_base_eur := CASE
      WHEN v_currency = 'EUR' THEN coalesce(v_updated.coste_total_eur, v_base_original)
      WHEN v_planned_fx IS NOT NULL THEN v_base_original * v_planned_fx
      ELSE coalesce(v_updated.coste_total_eur, 0)
    END;

    UPDATE public.finance_supplier_payments fsp
    SET
      due_date = CASE
        WHEN fsp.payment_type = 'DEPOSITO_30' THEN v_deposit_due
        ELSE v_balance_due
      END,
      amount_original = CASE
        WHEN fsp.payment_type = 'DEPOSITO_30' THEN v_base_original * (v_deposit_pct / 100)
        ELSE v_base_original * (v_balance_pct / 100)
      END,
      original_currency = v_currency,
      planned_fx_rate = v_planned_fx,
      amount_eur = CASE
        WHEN fsp.payment_type = 'DEPOSITO_30' THEN v_base_eur * (v_deposit_pct / 100)
        ELSE v_base_eur * (v_balance_pct / 100)
      END,
      status = CASE
        WHEN (
          CASE WHEN fsp.payment_type = 'DEPOSITO_30' THEN v_deposit_due ELSE v_balance_due END
        ) IS NOT NULL
        AND (
          CASE WHEN fsp.payment_type = 'DEPOSITO_30' THEN v_deposit_due ELSE v_balance_due END
        ) < CURRENT_DATE
          THEN 'vencido'
        ELSE 'pendiente'
      END,
      updated_at = now()
    WHERE fsp.orden_id = p_order_id
      AND fsp.status IN ('pendiente', 'vencido');
  END IF;

  SELECT *
  INTO v_updated
  FROM public.ordenes_compra
  WHERE id = p_order_id;

  RETURN v_updated;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_confirmed_purchase_order(uuid, jsonb, jsonb)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.update_confirmed_purchase_order(uuid, jsonb, jsonb)
TO authenticated, service_role;
