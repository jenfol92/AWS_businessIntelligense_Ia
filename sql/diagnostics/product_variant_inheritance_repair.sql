-- Reparacion idempotente de herencia padre -> variantes.
-- Revisar y reemplazar target_parent antes de ejecutar.
-- Regla: rellenar solo huecos del hijo; no sobrescribir valores propios.

BEGIN;

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
children AS (
  SELECT h.*
  FROM public.productos h
  JOIN parent_product p ON p.id = h.parent_id
)
UPDATE public.productos h
SET
  proveedor_id = COALESCE(h.proveedor_id, p.proveedor_id),
  stock_seguridad_minimo = COALESCE(NULLIF(h.stock_seguridad_minimo, 0), p.stock_seguridad_minimo),
  arancel_porcentaje = COALESCE(NULLIF(h.arancel_porcentaje, 0), p.arancel_porcentaje),
  especificaciones = jsonb_set(
    COALESCE(p.especificaciones, '{}'::jsonb) || COALESCE(h.especificaciones, '{}'::jsonb),
    '{form_extensions_v1,identifiers,referencia_fabricante}',
    to_jsonb(
      COALESCE(
        NULLIF(h.especificaciones #>> '{form_extensions_v1,identifiers,referencia_fabricante}', ''),
        NULLIF(p.especificaciones #>> '{form_extensions_v1,identifiers,referencia_fabricante}', '')
      )
    ),
    true
  )
FROM children c
JOIN parent_product p ON true
WHERE h.id = c.id
  AND (
    h.proveedor_id IS NULL
    OR COALESCE(h.stock_seguridad_minimo, 0) = 0
    OR COALESCE(h.arancel_porcentaje, 0) = 0
    OR COALESCE(h.especificaciones, '{}'::jsonb) = '{}'::jsonb
    OR NULLIF(h.especificaciones #>> '{form_extensions_v1,identifiers,referencia_fabricante}', '') IS NULL
  );

WITH parent_product AS (
  SELECT p.*
  FROM public.productos p
  WHERE p.id::text = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.sku = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.nombre ILIKE '%' || 'REEMPLAZAR_PARENT_ID_O_SKU' || '%'
  ORDER BY p.created_at DESC NULLS LAST
  LIMIT 1
),
children AS (
  SELECT h.id
  FROM public.productos h
  JOIN parent_product p ON p.id = h.parent_id
),
parent_detail AS (
  SELECT d.*
  FROM public.producto_detalle d
  JOIN parent_product p ON p.id = d.producto_id
)
INSERT INTO public.producto_detalle (
  producto_id,
  descripcion_tecnica,
  categoria_id,
  categoria,
  marca
)
SELECT
  c.id,
  pd.descripcion_tecnica,
  pd.categoria_id,
  pd.categoria,
  pd.marca
FROM children c
CROSS JOIN parent_detail pd
WHERE NOT EXISTS (
  SELECT 1 FROM public.producto_detalle x WHERE x.producto_id = c.id
);

WITH parent_product AS (
  SELECT p.*
  FROM public.productos p
  WHERE p.id::text = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.sku = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.nombre ILIKE '%' || 'REEMPLAZAR_PARENT_ID_O_SKU' || '%'
  ORDER BY p.created_at DESC NULLS LAST
  LIMIT 1
),
children AS (
  SELECT h.id
  FROM public.productos h
  JOIN parent_product p ON p.id = h.parent_id
),
parent_detail AS (
  SELECT d.*
  FROM public.producto_detalle d
  JOIN parent_product p ON p.id = d.producto_id
)
UPDATE public.producto_detalle d
SET
  descripcion_tecnica = COALESCE(NULLIF(d.descripcion_tecnica, ''), pd.descripcion_tecnica),
  categoria_id = COALESCE(d.categoria_id, pd.categoria_id),
  categoria = COALESCE(NULLIF(d.categoria, ''), pd.categoria),
  marca = COALESCE(NULLIF(d.marca, ''), pd.marca)
FROM children c
CROSS JOIN parent_detail pd
WHERE d.producto_id = c.id;

WITH parent_product AS (
  SELECT p.*
  FROM public.productos p
  WHERE p.id::text = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.sku = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.nombre ILIKE '%' || 'REEMPLAZAR_PARENT_ID_O_SKU' || '%'
  ORDER BY p.created_at DESC NULLS LAST
  LIMIT 1
),
children AS (
  SELECT h.id
  FROM public.productos h
  JOIN parent_product p ON p.id = h.parent_id
),
parent_logistics AS (
  SELECT pl.*
  FROM public.producto_logistica pl
  JOIN parent_product p ON p.id = pl.producto_id
)
INSERT INTO public.producto_logistica (
  producto_id,
  unidades_por_caja,
  peso_kg_bruto,
  pedido_minimo_unidades,
  largo_cm,
  ancho_cm,
  alto_cm
)
SELECT
  c.id,
  pl.unidades_por_caja,
  pl.peso_kg_bruto,
  pl.pedido_minimo_unidades,
  pl.largo_cm,
  pl.ancho_cm,
  pl.alto_cm
FROM children c
CROSS JOIN parent_logistics pl
WHERE NOT EXISTS (
  SELECT 1 FROM public.producto_logistica x WHERE x.producto_id = c.id
);

WITH parent_product AS (
  SELECT p.*
  FROM public.productos p
  WHERE p.id::text = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.sku = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.nombre ILIKE '%' || 'REEMPLAZAR_PARENT_ID_O_SKU' || '%'
  ORDER BY p.created_at DESC NULLS LAST
  LIMIT 1
),
children AS (
  SELECT h.id
  FROM public.productos h
  JOIN parent_product p ON p.id = h.parent_id
),
parent_logistics AS (
  SELECT pl.*
  FROM public.producto_logistica pl
  JOIN parent_product p ON p.id = pl.producto_id
)
UPDATE public.producto_logistica pl
SET
  unidades_por_caja = COALESCE(NULLIF(pl.unidades_por_caja, 0), parent_logistics.unidades_por_caja),
  peso_kg_bruto = COALESCE(pl.peso_kg_bruto, parent_logistics.peso_kg_bruto),
  pedido_minimo_unidades = COALESCE(NULLIF(pl.pedido_minimo_unidades, 0), parent_logistics.pedido_minimo_unidades),
  largo_cm = COALESCE(pl.largo_cm, parent_logistics.largo_cm),
  ancho_cm = COALESCE(pl.ancho_cm, parent_logistics.ancho_cm),
  alto_cm = COALESCE(pl.alto_cm, parent_logistics.alto_cm)
FROM children c
CROSS JOIN parent_logistics
WHERE pl.producto_id = c.id;

WITH parent_product AS (
  SELECT p.*
  FROM public.productos p
  WHERE p.id::text = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.sku = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.nombre ILIKE '%' || 'REEMPLAZAR_PARENT_ID_O_SKU' || '%'
  ORDER BY p.created_at DESC NULLS LAST
  LIMIT 1
),
children AS (
  SELECT h.id
  FROM public.productos h
  JOIN parent_product p ON p.id = h.parent_id
),
parent_tech AS (
  SELECT ft.*
  FROM public.producto_ficha_tecnica ft
  JOIN parent_product p ON p.id = ft.producto_id
)
INSERT INTO public.producto_ficha_tecnica (
  producto_id,
  modelo,
  peso_neto_kg,
  alto_abierto_cm,
  ancho_abierto_cm,
  fondo_abierto_cm,
  alto_plegado_cm,
  ancho_plegado_cm,
  fondo_plegado_cm,
  material_estructura,
  material_tapizado,
  material_ruedas,
  edad_minima_aplicable,
  edad_maxima_aplicable
)
SELECT
  c.id,
  ft.modelo,
  ft.peso_neto_kg,
  ft.alto_abierto_cm,
  ft.ancho_abierto_cm,
  ft.fondo_abierto_cm,
  ft.alto_plegado_cm,
  ft.ancho_plegado_cm,
  ft.fondo_plegado_cm,
  ft.material_estructura,
  ft.material_tapizado,
  ft.material_ruedas,
  ft.edad_minima_aplicable,
  ft.edad_maxima_aplicable
FROM children c
CROSS JOIN parent_tech ft
WHERE NOT EXISTS (
  SELECT 1 FROM public.producto_ficha_tecnica x WHERE x.producto_id = c.id
);

WITH parent_product AS (
  SELECT p.*
  FROM public.productos p
  WHERE p.id::text = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.sku = 'REEMPLAZAR_PARENT_ID_O_SKU'
     OR p.nombre ILIKE '%' || 'REEMPLAZAR_PARENT_ID_O_SKU' || '%'
  ORDER BY p.created_at DESC NULLS LAST
  LIMIT 1
),
children AS (
  SELECT h.id
  FROM public.productos h
  JOIN parent_product p ON p.id = h.parent_id
),
parent_tech AS (
  SELECT ft.*
  FROM public.producto_ficha_tecnica ft
  JOIN parent_product p ON p.id = ft.producto_id
)
UPDATE public.producto_ficha_tecnica ft
SET
  modelo = COALESCE(NULLIF(ft.modelo, ''), parent_tech.modelo),
  peso_neto_kg = COALESCE(ft.peso_neto_kg, parent_tech.peso_neto_kg),
  alto_abierto_cm = COALESCE(ft.alto_abierto_cm, parent_tech.alto_abierto_cm),
  ancho_abierto_cm = COALESCE(ft.ancho_abierto_cm, parent_tech.ancho_abierto_cm),
  fondo_abierto_cm = COALESCE(ft.fondo_abierto_cm, parent_tech.fondo_abierto_cm),
  alto_plegado_cm = COALESCE(ft.alto_plegado_cm, parent_tech.alto_plegado_cm),
  ancho_plegado_cm = COALESCE(ft.ancho_plegado_cm, parent_tech.ancho_plegado_cm),
  fondo_plegado_cm = COALESCE(ft.fondo_plegado_cm, parent_tech.fondo_plegado_cm),
  material_estructura = COALESCE(NULLIF(ft.material_estructura, ''), parent_tech.material_estructura),
  material_tapizado = COALESCE(NULLIF(ft.material_tapizado, ''), parent_tech.material_tapizado),
  material_ruedas = COALESCE(NULLIF(ft.material_ruedas, ''), parent_tech.material_ruedas),
  edad_minima_aplicable = COALESCE(ft.edad_minima_aplicable, parent_tech.edad_minima_aplicable),
  edad_maxima_aplicable = COALESCE(ft.edad_maxima_aplicable, parent_tech.edad_maxima_aplicable)
FROM children c
CROSS JOIN parent_tech
WHERE ft.producto_id = c.id;

COMMIT;
