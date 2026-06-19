-- Diagnóstico: preparación y simulación de facturación de costes por contenedor
-- Sustituir el UUID del contenedor en el filtro de cont (línea ~8)

WITH cont AS (
  SELECT c.*
  FROM public.contenedores c
  -- WHERE c.id = '00000000-0000-0000-0000-000000000000'
  ORDER BY c.created_at DESC
  LIMIT 1
),
ordenes_vinculadas AS (
  SELECT co.contenedor_id, co.orden_id, oc.numero_orden, oc.moneda_compra, oc.tipo_cambio_moneda_eur, oc.destino
  FROM public.contenedor_ordenes co
  JOIN public.ordenes_compra oc ON oc.id = co.orden_id
  WHERE co.contenedor_id = (SELECT id FROM cont)
),
lineas AS (
  SELECT
    oi.id AS orden_item_id,
    oi.producto_id,
    oi.cantidad,
    oi.cbm_unitario,
    oi.cbm_total,
    oi.coste_unitario_moneda,
    oi.coste_unitario_eur,
    oi.lote_producto,
    p.sku,
    p.nombre AS producto,
    ov.numero_orden,
    ov.tipo_cambio_moneda_eur,
    c.id AS contenedor_id,
    c.identificador_embarque,
    COALESCE(c.costo_flete_total_eur, c.flete, 0) AS flete_total,
    COALESCE(c.gastos_llegada_puerto_eur, c.gastos_llegada_puerto, 0) AS gastos_llegada_total,
    COALESCE(c.costo_transito_total_eur, 0) AS transito_total,
    SUM(oi.cbm_total) OVER (PARTITION BY c.id) AS cbm_total_contenedor
  FROM cont c
  JOIN ordenes_vinculadas ov ON ov.contenedor_id = c.id
  JOIN public.orden_items oi ON oi.orden_id = ov.orden_id
  JOIN public.productos p ON p.id = oi.producto_id
),
calculado AS (
  SELECT
    l.*,
    CASE
      WHEN l.cbm_total_contenedor > 0 THEN l.cbm_total / l.cbm_total_contenedor
      ELSE 0
    END AS peso_cbm,
    CASE
      WHEN l.cbm_total_contenedor > 0 AND l.cantidad > 0
        THEN ROUND((l.flete_total * (l.cbm_total / l.cbm_total_contenedor) / l.cantidad)::numeric, 4)
      ELSE NULL
    END AS flete_unitario_calculado,
    CASE
      WHEN l.cbm_total_contenedor > 0 AND l.cantidad > 0
        THEN ROUND((l.gastos_llegada_total * (l.cbm_total / l.cbm_total_contenedor) / l.cantidad)::numeric, 4)
      ELSE NULL
    END AS gastos_llegada_unitario_calculado,
    CASE
      WHEN l.cbm_total_contenedor > 0 AND l.cantidad > 0
        THEN ROUND((l.transito_total * (l.cbm_total / l.cbm_total_contenedor) / l.cantidad)::numeric, 4)
      ELSE NULL
    END AS transito_unitario_calculado
  FROM lineas l
),
existente AS (
  SELECT pc.id, pc.producto_id, pc.lote_producto, pc.costo_unitario_total_eur
  FROM public.producto_costos pc
  WHERE pc.contenedor_id = (SELECT id FROM cont)
)
SELECT
  c.contenedor_id,
  c.identificador_embarque,
  c.numero_orden,
  c.sku,
  c.producto,
  c.lote_producto,
  c.cantidad,
  c.cbm_unitario,
  c.cbm_total,
  c.coste_unitario_moneda,
  c.coste_unitario_eur,
  c.tipo_cambio_moneda_eur,
  c.peso_cbm,
  c.flete_unitario_calculado,
  c.gastos_llegada_unitario_calculado,
  c.transito_unitario_calculado,
  ROUND(
    (
      COALESCE(c.coste_unitario_eur, 0)
      + COALESCE(c.flete_unitario_calculado, 0)
      + COALESCE(c.gastos_llegada_unitario_calculado, 0)
      + COALESCE(c.transito_unitario_calculado, 0)
    )::numeric,
    4
  ) AS costo_unitario_total_eur_calculado,
  e.id AS producto_costos_existente,
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM cont) THEN 'SIN_CONTENEDOR'
    WHEN NOT EXISTS (SELECT 1 FROM lineas) THEN 'SIN_ORDENES'
    WHEN c.cantidad IS NULL OR c.cantidad <= 0 THEN 'FALTA_CANTIDAD'
    WHEN c.cbm_total IS NULL OR c.cbm_total <= 0 THEN 'FALTA_CBM'
    WHEN c.coste_unitario_eur IS NULL OR c.coste_unitario_eur <= 0 THEN 'FALTA_COSTE_EUR'
    WHEN e.id IS NOT NULL THEN 'YA_FACTURADO'
    ELSE 'OK_PARA_FACTURAR'
  END AS estado_diagnostico
FROM calculado c
LEFT JOIN existente e
  ON e.producto_id = c.producto_id
 AND COALESCE(e.lote_producto, '') = COALESCE(NULLIF(TRIM(c.lote_producto), ''), c.orden_item_id::text, '')
ORDER BY c.numero_orden, c.sku;
