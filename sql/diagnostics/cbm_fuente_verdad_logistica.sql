-- Diagnóstico: fuente de verdad de medidas de caja (logística vs ficha legacy)
WITH medidas AS (
  SELECT
    p.id AS producto_id,
    p.sku,
    p.nombre,
    ft.largo_caja_cm AS ft_largo_cm,
    ft.ancho_caja_cm AS ft_ancho_cm,
    ft.alto_caja_cm AS ft_alto_cm,
    ft.peso_bruto_kg AS ft_peso_bruto_kg,
    pl.largo_cm AS pl_largo_cm,
    pl.ancho_cm AS pl_ancho_cm,
    pl.alto_cm AS pl_alto_cm,
    pl.peso_kg_bruto AS pl_peso_kg_bruto,
    pl.cubicaje_unitario_m3
  FROM public.productos p
  LEFT JOIN public.producto_ficha_tecnica ft ON ft.producto_id = p.id
  LEFT JOIN public.producto_logistica pl ON pl.producto_id = p.id
)
SELECT
  sku,
  nombre,
  ft_largo_cm,
  ft_ancho_cm,
  ft_alto_cm,
  ft_peso_bruto_kg,
  pl_largo_cm,
  pl_ancho_cm,
  pl_alto_cm,
  pl_peso_kg_bruto,
  cubicaje_unitario_m3,
  CASE
    WHEN pl_largo_cm IS NULL
      AND pl_ancho_cm IS NULL
      AND pl_alto_cm IS NULL
      AND pl_peso_kg_bruto IS NULL
      THEN 'SIN_LOGISTICA'
    WHEN (
      ft_largo_cm IS DISTINCT FROM pl_largo_cm
      OR ft_ancho_cm IS DISTINCT FROM pl_ancho_cm
      OR ft_alto_cm IS DISTINCT FROM pl_alto_cm
      OR ft_peso_bruto_kg IS DISTINCT FROM pl_peso_kg_bruto
    )
    AND ft_largo_cm IS NOT NULL
      THEN 'DIFERENCIA_FICHA_LOGISTICA'
    ELSE 'OK'
  END AS estado
FROM medidas
WHERE sku = '8436616610470'
   OR pl_largo_cm IS NULL
   OR ft_largo_cm IS DISTINCT FROM pl_largo_cm
ORDER BY sku;
