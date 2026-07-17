-- SELECT-only: audita herencia padre -> variantes sin modificar datos.
-- Reemplazar el valor de target_parent por el producto padre afectado
-- (id, sku o nombre parcial) antes de ejecutar.

WITH target_parent AS (
  SELECT 'REEMPLAZAR_PARENT_ID_O_SKU'::text AS q
),
parent_product AS (
  SELECT p.*
  FROM public.productos p
  CROSS JOIN target_parent t
  WHERE p.id::text = t.q
     OR p.sku = t.q
     OR p.nombre ILIKE '%' || t.q || '%'
  ORDER BY p.created_at DESC NULLS LAST
  LIMIT 1
),
family AS (
  SELECT p.id AS parent_id, p.id AS product_id, 'PADRE'::text AS row_type
  FROM parent_product p
  UNION ALL
  SELECT pp.id AS parent_id, h.id AS product_id, 'VARIANTE'::text AS row_type
  FROM parent_product pp
  JOIN public.productos h ON h.parent_id = pp.id
),
spec_counts AS (
  SELECT
    f.product_id,
    count(*) FILTER (WHERE kv.key <> 'form_extensions_v1') AS spec_count
  FROM family f
  JOIN public.productos p ON p.id = f.product_id
  LEFT JOIN LATERAL jsonb_each(COALESCE(p.especificaciones, '{}'::jsonb)) kv
    ON true
  GROUP BY f.product_id
),
material_counts AS (
  SELECT
    f.product_id,
    (
      (ft.material_estructura IS NOT NULL AND btrim(ft.material_estructura) <> '')::int +
      (ft.material_tapizado IS NOT NULL AND btrim(ft.material_tapizado) <> '')::int +
      (ft.material_ruedas IS NOT NULL AND btrim(ft.material_ruedas) <> '')::int
    ) AS material_count
  FROM family f
  LEFT JOIN public.producto_ficha_tecnica ft ON ft.producto_id = f.product_id
),
measure_flags AS (
  SELECT
    f.product_id,
    (
      ft.peso_neto_kg IS NOT NULL
      OR pl.peso_kg_bruto IS NOT NULL
      OR pl.largo_cm IS NOT NULL
      OR pl.ancho_cm IS NOT NULL
      OR pl.alto_cm IS NOT NULL
      OR pl.cubicaje_unitario_m3 IS NOT NULL
      OR pl.unidades_por_caja IS NOT NULL
      OR ft.alto_abierto_cm IS NOT NULL
      OR ft.ancho_abierto_cm IS NOT NULL
      OR ft.fondo_abierto_cm IS NOT NULL
      OR ft.alto_plegado_cm IS NOT NULL
      OR ft.ancho_plegado_cm IS NOT NULL
      OR ft.fondo_plegado_cm IS NOT NULL
    ) AS has_weights_or_measures
  FROM family f
  LEFT JOIN public.producto_ficha_tecnica ft ON ft.producto_id = f.product_id
  LEFT JOIN public.producto_logistica pl ON pl.producto_id = f.product_id
)
SELECT
  f.row_type,
  parent.id AS parent_id,
  parent.sku AS parent_sku,
  parent.nombre AS parent_nombre,
  p.id AS producto_id,
  p.sku,
  p.nombre,
  parent.especificaciones #>> '{form_extensions_v1,identifiers,referencia_fabricante}'
    AS referencia_fabricante_padre,
  p.especificaciones #>> '{form_extensions_v1,identifiers,referencia_fabricante}'
    AS referencia_fabricante_variante,
  pd_parent.categoria_id AS categoria_id_padre,
  pd_parent.categoria AS categoria_padre,
  pd.categoria_id AS categoria_id_variante,
  pd.categoria AS categoria_variante,
  sc.spec_count AS numero_especificaciones,
  mc.material_count AS numero_materiales,
  mf.has_weights_or_measures AS existe_pesos_y_medidas
FROM family f
JOIN parent_product parent ON parent.id = f.parent_id
JOIN public.productos p ON p.id = f.product_id
LEFT JOIN public.producto_detalle pd_parent ON pd_parent.producto_id = parent.id
LEFT JOIN public.producto_detalle pd ON pd.producto_id = p.id
LEFT JOIN spec_counts sc ON sc.product_id = p.id
LEFT JOIN material_counts mc ON mc.product_id = p.id
LEFT JOIN measure_flags mf ON mf.product_id = p.id
ORDER BY f.row_type, p.created_at, p.sku;
