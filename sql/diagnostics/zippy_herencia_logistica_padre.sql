-- Diagnóstico: herencia logística padre → variante (ZIPPY y otras)
WITH hijos AS (
  SELECT
    h.id AS hijo_id,
    h.sku AS sku_hijo,
    h.nombre AS nombre_hijo,
    h.parent_id,
    pl_h.largo_cm AS hijo_largo_cm,
    pl_h.ancho_cm AS hijo_ancho_cm,
    pl_h.alto_cm AS hijo_alto_cm,
    pl_h.peso_kg_bruto AS hijo_peso_kg_bruto,
    pl_h.cubicaje_unitario_m3 AS hijo_cubicaje_unitario_m3
  FROM public.productos h
  LEFT JOIN public.producto_logistica pl_h ON pl_h.producto_id = h.id
  WHERE h.sku IN ('8436616610418', '8436616610432')
     OR h.parent_id IS NOT NULL
)
SELECT
  hj.sku_hijo,
  hj.nombre_hijo,
  p.sku AS sku_padre,
  p.nombre AS nombre_padre,
  hj.hijo_largo_cm,
  hj.hijo_ancho_cm,
  hj.hijo_alto_cm,
  hj.hijo_peso_kg_bruto,
  hj.hijo_cubicaje_unitario_m3,
  pl_p.largo_cm AS padre_largo_cm,
  pl_p.ancho_cm AS padre_ancho_cm,
  pl_p.alto_cm AS padre_alto_cm,
  pl_p.peso_kg_bruto AS padre_peso_kg_bruto,
  pl_p.cubicaje_unitario_m3 AS padre_cubicaje_unitario_m3,
  CASE
    WHEN hj.parent_id IS NULL THEN 'SIN_PADRE'
    WHEN pl_p.producto_id IS NULL THEN 'PADRE_SIN_LOGISTICA'
    WHEN hj.hijo_largo_cm IS NULL
      AND hj.hijo_ancho_cm IS NULL
      AND hj.hijo_alto_cm IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.producto_logistica x WHERE x.producto_id = hj.hijo_id
      )
      THEN 'HIJO_SIN_LOGISTICA'
    WHEN (
      hj.hijo_largo_cm IS NULL
      OR hj.hijo_ancho_cm IS NULL
      OR hj.hijo_alto_cm IS NULL
      OR hj.hijo_peso_kg_bruto IS NULL
      OR COALESCE(hj.hijo_cubicaje_unitario_m3, 0) = 0
    )
    AND COALESCE(pl_p.cubicaje_unitario_m3, 0) > 0
      THEN 'HIJO_LOGISTICA_INCOMPLETA'
    ELSE 'OK'
  END AS estado_herencia
FROM hijos hj
LEFT JOIN public.productos p ON p.id = hj.parent_id
LEFT JOIN public.producto_logistica pl_p ON pl_p.producto_id = p.id
ORDER BY hj.sku_hijo;
