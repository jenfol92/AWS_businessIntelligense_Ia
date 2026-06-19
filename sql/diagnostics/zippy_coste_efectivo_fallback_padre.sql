-- Diagnóstico: coste base efectivo con fallback al padre (ZIPPY y variantes)
-- Regla: propio > 0 → own; si no, padre > 0 → parent; si no → none

WITH productos_zippy AS (
  SELECT p.*
  FROM public.productos p
  WHERE p.nombre ILIKE '%ZIPPY%'
     OR p.sku LIKE '8436616610%'
     OR p.parent_id IN (
       SELECT id FROM public.productos WHERE nombre ILIKE '%ZIPPY%' OR sku LIKE '8436616610%'
     )
),
ultimo_coste_propio AS (
  SELECT DISTINCT ON (pc.producto_id)
    pc.producto_id,
    pc.costo_fabrica_monto,
    pc.costo_fabrica_moneda
  FROM public.producto_costos pc
  ORDER BY pc.producto_id, pc.fecha DESC NULLS LAST
),
coste_padre AS (
  SELECT
    p.id AS producto_id,
    ucp.costo_fabrica_monto AS coste_padre,
    ucp.costo_fabrica_moneda AS moneda_padre,
    padre.sku AS sku_padre
  FROM productos_zippy p
  LEFT JOIN public.productos padre ON padre.id = p.parent_id
  LEFT JOIN ultimo_coste_propio ucp ON ucp.producto_id = p.parent_id
)
SELECT
  p.sku,
  p.nombre,
  p.parent_id,
  ucp.costo_fabrica_monto AS coste_propio,
  ucp.costo_fabrica_moneda AS moneda_propia,
  cp.sku_padre,
  cp.coste_padre,
  cp.moneda_padre,
  CASE
    WHEN COALESCE(ucp.costo_fabrica_monto, 0) > 0
      THEN ucp.costo_fabrica_monto
    WHEN COALESCE(cp.coste_padre, 0) > 0
      THEN cp.coste_padre
    ELSE NULL
  END AS coste_base_efectivo,
  CASE
    WHEN COALESCE(ucp.costo_fabrica_monto, 0) > 0
      THEN ucp.costo_fabrica_moneda
    WHEN COALESCE(cp.coste_padre, 0) > 0
      THEN cp.moneda_padre
    ELSE NULL
  END AS moneda_efectiva,
  CASE
    WHEN COALESCE(ucp.costo_fabrica_monto, 0) > 0
      THEN 'own'
    WHEN COALESCE(cp.coste_padre, 0) > 0
      THEN 'parent'
    ELSE 'none'
  END AS source,
  CASE
    WHEN COALESCE(ucp.costo_fabrica_monto, 0) > 0
      THEN 'USA_COSTE_PROPIO'
    WHEN COALESCE(cp.coste_padre, 0) > 0
      THEN 'USA_COSTE_PADRE'
    ELSE 'SIN_COSTE_VALIDO'
  END AS estado
FROM productos_zippy p
LEFT JOIN ultimo_coste_propio ucp ON ucp.producto_id = p.id
LEFT JOIN coste_padre cp ON cp.producto_id = p.id
ORDER BY p.sku;
