-- Diagnóstico: flujo costes producto → orden → lote → producto_costos
-- Ejemplo: variantes ZIPPY (8436616610418, 8436616610432) y padre

WITH productos_objetivo AS (
  SELECT p.*
  FROM public.productos p
  WHERE p.sku IN (
    '8436616610418',
    '8436616610432',
    '8436616610470'
  )
  OR p.parent_id IN (
    SELECT id FROM public.productos WHERE sku LIKE '8436616610%'
  )
),
ultimo_coste_producto AS (
  SELECT DISTINCT ON (pc.producto_id)
    pc.producto_id,
    pc.costo_fabrica_monto,
    pc.costo_fabrica_moneda,
    pc.costo_fabrica_eur,
    pc.tipo_cambio_aplicado,
    pc.costo_unitario_total_eur,
    pc.lote_producto,
    pc.contenedor_id,
    pc.fecha
  FROM public.producto_costos pc
  ORDER BY pc.producto_id, pc.fecha DESC NULLS LAST
),
coste_padre AS (
  SELECT
    p.id AS producto_id,
    ucp.costo_fabrica_monto AS coste_padre_monto,
    ucp.costo_fabrica_moneda AS coste_padre_moneda
  FROM productos_objetivo p
  LEFT JOIN ultimo_coste_producto ucp ON ucp.producto_id = p.parent_id
),
lineas_orden AS (
  SELECT
    oi.producto_id,
    oc.numero_orden,
    oi.lote_producto,
    oi.cantidad,
    oi.coste_unitario_moneda,
    oc.moneda_compra,
    oc.tipo_cambio_moneda_eur,
    oi.coste_unitario_eur,
    oc.estado AS estado_orden
  FROM public.orden_items oi
  JOIN public.ordenes_compra oc ON oc.id = oi.orden_id
)
SELECT
  p.sku,
  p.nombre,
  p.parent_id,
  p.heredar_precio,
  ucp.costo_fabrica_monto AS coste_propio,
  ucp.costo_fabrica_moneda AS moneda_propia,
  CASE
    WHEN COALESCE(ucp.costo_fabrica_monto, 0) > 0
      THEN ucp.costo_fabrica_monto
    WHEN COALESCE(cp.coste_padre_monto, 0) > 0
      THEN cp.coste_padre_monto
    ELSE NULL
  END AS coste_base_efectivo,
  CASE
    WHEN COALESCE(ucp.costo_fabrica_monto, 0) > 0
      THEN ucp.costo_fabrica_moneda
    WHEN COALESCE(cp.coste_padre_monto, 0) > 0
      THEN cp.coste_padre_moneda
    ELSE NULL
  END AS moneda_efectiva,
  CASE
    WHEN COALESCE(ucp.costo_fabrica_monto, 0) > 0 THEN 'own'
    WHEN COALESCE(cp.coste_padre_monto, 0) > 0 THEN 'parent'
    ELSE 'none'
  END AS coste_source,
  lo.numero_orden AS orden,
  lo.lote_producto,
  lo.cantidad,
  lo.coste_unitario_moneda AS coste_unitario_moneda_orden,
  lo.moneda_compra AS moneda_orden,
  lo.tipo_cambio_moneda_eur AS tipo_cambio_orden,
  lo.coste_unitario_eur AS coste_unitario_eur_orden,
  ucp.costo_unitario_total_eur AS ultimo_producto_costos_total_eur,
  ucp.costo_fabrica_eur AS ultimo_costo_fabrica_eur_legacy,
  CASE
    WHEN COALESCE(ucp.costo_fabrica_monto, 0) <= 0
      AND COALESCE(cp.coste_padre_monto, 0) <= 0
      THEN 'PRODUCTO_SOLO_SIN_COSTE_BASE'
    WHEN ucp.costo_unitario_total_eur IS NULL
      AND (ucp.costo_fabrica_eur IS NULL OR ucp.costo_fabrica_eur = 0)
      AND COALESCE(ucp.costo_fabrica_monto, 0) > 0
      THEN 'PRODUCTO_SOLO_COSTE_BASE'
    WHEN COALESCE(ucp.costo_fabrica_monto, 0) <= 0
      AND COALESCE(cp.coste_padre_monto, 0) > 0
      AND lo.numero_orden IS NULL
      THEN 'PRODUCTO_USA_COSTE_PADRE'
    WHEN lo.numero_orden IS NULL
      THEN 'PRODUCTO_SOLO_COSTE_BASE'
    WHEN lo.moneda_compra IS DISTINCT FROM 'EUR'
      AND (lo.tipo_cambio_moneda_eur IS NULL OR lo.tipo_cambio_moneda_eur <= 0)
      AND (lo.coste_unitario_eur IS NULL OR lo.coste_unitario_eur = 0)
      THEN 'ORDEN_SIN_TIPO_CAMBIO'
    WHEN lo.coste_unitario_eur IS NOT NULL AND lo.coste_unitario_eur > 0
      THEN 'ORDEN_COSTE_EUR_OK'
    WHEN ucp.costo_unitario_total_eur IS NOT NULL AND ucp.costo_unitario_total_eur > 0
      THEN 'STOCK_DISPONIBLE_COSTE_REAL_OK'
    ELSE 'STOCK_PENDIENTE'
  END AS estado_coste
FROM productos_objetivo p
LEFT JOIN ultimo_coste_producto ucp ON ucp.producto_id = p.id
LEFT JOIN coste_padre cp ON cp.producto_id = p.id
LEFT JOIN lineas_orden lo ON lo.producto_id = p.id
ORDER BY p.sku, lo.numero_orden NULLS LAST;
