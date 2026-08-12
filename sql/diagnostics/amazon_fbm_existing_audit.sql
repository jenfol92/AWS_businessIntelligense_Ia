-- Auditoría Amazon FBM / All Orders / MFN — solo lectura.
-- Objetivo: detectar si FBM/MFN/All Orders alimentan ventas_diarias o inventario_paises.
-- Ejecutar en Supabase SQL Editor o psql. No modifica datos.
--
-- Nota de esquema:
--   inventario_paises NO tiene columnas canal_venta ni source.
--   El stock FBM vive en inventario_paises.stock_fbm (columna numérica por producto/pais).
--   La sección 03 usa stock_fbm > 0 en lugar del filtro por source inexistente.

-- =============================================================================
-- 01 — ventas_diarias por canal y source (todas las fuentes)
-- =============================================================================
SELECT
  '01_ventas_diarias_por_canal_source' AS seccion,
  canal_venta,
  source,
  MIN(fecha) AS primera_fecha,
  MAX(fecha) AS ultima_fecha,
  COUNT(*) AS filas,
  SUM(unidades_vendidas) AS unidades,
  SUM(ingresos_brutos) AS ingresos
FROM public.ventas_diarias
GROUP BY canal_venta, source
ORDER BY canal_venta, source;

-- =============================================================================
-- 02 — ventas_diarias FBM / MFN / All Orders / Amazon (candidatos FBM Amazon)
-- =============================================================================
SELECT
  '02_ventas_fbm_mfn_all_orders' AS seccion,
  canal_venta,
  source,
  pais,
  marketplace_id,
  MIN(fecha) AS primera_fecha,
  MAX(fecha) AS ultima_fecha,
  COUNT(*) AS filas,
  SUM(unidades_vendidas) AS unidades
FROM public.ventas_diarias
WHERE UPPER(COALESCE(canal_venta, '')) = 'FBM'
   OR LOWER(COALESCE(source, '')) LIKE '%fbm%'
   OR LOWER(COALESCE(source, '')) LIKE '%mfn%'
   OR LOWER(COALESCE(source, '')) LIKE '%all_order%'
   OR LOWER(COALESCE(source, '')) LIKE '%all-orders%'
   OR LOWER(COALESCE(source, '')) LIKE '%merchant%'
GROUP BY canal_venta, source, pais, marketplace_id
ORDER BY unidades DESC NULLS LAST;

-- =============================================================================
-- 03 — inventario_paises con stock FBM (no hay canal_venta/source en esta tabla)
-- =============================================================================
SELECT
  '03_inventario_paises_con_stock_fbm' AS seccion,
  COUNT(*) AS filas_con_fbm,
  COUNT(DISTINCT producto_id) AS productos_distintos,
  COUNT(DISTINCT pais) AS paises_distintos,
  SUM(COALESCE(stock_fbm, 0)) AS unidades_fbm_total,
  MIN(updated_at) AS updated_at_min,
  MAX(updated_at) AS updated_at_max
FROM public.inventario_paises
WHERE COALESCE(stock_fbm, 0) > 0;

-- Detalle top filas FBM por unidades
SELECT
  '03b_inventario_paises_fbm_top' AS seccion,
  i.producto_id,
  p.sku,
  i.pais,
  i.stock_fba,
  i.stock_fbm,
  i.updated_at
FROM public.inventario_paises i
LEFT JOIN public.productos p ON p.id = i.producto_id
WHERE COALESCE(i.stock_fbm, 0) > 0
ORDER BY i.stock_fbm DESC, i.updated_at DESC NULLS LAST
LIMIT 100;

-- =============================================================================
-- 04 — amazon_sync_jobs relacionados con orders / fbm / all
-- =============================================================================
SELECT
  '04_amazon_sync_jobs' AS seccion,
  job_key,
  last_run_at,
  last_success_at,
  last_status,
  last_error,
  last_rows_upserted,
  next_run_hint,
  updated_at
FROM public.amazon_sync_jobs
WHERE LOWER(job_key) LIKE '%fbm%'
   OR LOWER(job_key) LIKE '%mfn%'
   OR LOWER(job_key) LIKE '%order%'
   OR LOWER(job_key) LIKE '%all%'
ORDER BY job_key;

-- Todos los jobs (contexto)
SELECT
  '04b_amazon_sync_jobs_todos' AS seccion,
  job_key,
  last_success_at,
  last_status,
  last_rows_upserted
FROM public.amazon_sync_jobs
ORDER BY job_key;

-- =============================================================================
-- 05 — duplicados exactos (mismo grano + mismo source)
-- =============================================================================
SELECT
  '05_duplicados_mismo_grano_mismo_source' AS seccion,
  producto_id,
  fecha,
  pais,
  canal_venta,
  moneda,
  marketplace_id,
  tipo_cliente,
  source,
  COUNT(*) AS filas,
  SUM(unidades_vendidas) AS unidades
FROM public.ventas_diarias
GROUP BY
  producto_id,
  fecha,
  pais,
  canal_venta,
  moneda,
  marketplace_id,
  tipo_cliente,
  source
HAVING COUNT(*) > 1
ORDER BY filas DESC, fecha DESC
LIMIT 200;

-- =============================================================================
-- 06 — mismo grano con distintos source (riesgo FBA/FBM solapado)
-- =============================================================================
SELECT
  '06_mismo_grano_distinto_source' AS seccion,
  producto_id,
  fecha,
  pais,
  canal_venta,
  moneda,
  marketplace_id,
  tipo_cliente,
  COUNT(DISTINCT source) AS sources_distintos,
  ARRAY_AGG(DISTINCT source ORDER BY source) AS sources,
  SUM(unidades_vendidas) AS unidades
FROM public.ventas_diarias
GROUP BY
  producto_id,
  fecha,
  pais,
  canal_venta,
  moneda,
  marketplace_id,
  tipo_cliente
HAVING COUNT(DISTINCT source) > 1
ORDER BY fecha DESC, unidades DESC NULLS LAST
LIMIT 200;

-- =============================================================================
-- 07 — staging All Orders: filas FBM/MFN antes de ventas_diarias
-- =============================================================================
SELECT
  '07_amazon_all_orders_items_por_canal' AS seccion,
  canal_venta,
  fulfillment_channel,
  source,
  MIN(purchase_date) AS primera_fecha,
  MAX(purchase_date) AS ultima_fecha,
  COUNT(*) AS filas,
  SUM(quantity) AS unidades,
  COUNT(*) FILTER (WHERE producto_id IS NULL) AS filas_sin_producto
FROM public.amazon_all_orders_items
GROUP BY canal_venta, fulfillment_channel, source
ORDER BY unidades DESC NULLS LAST;

SELECT
  '07b_amazon_all_orders_items_fbm_mfn' AS seccion,
  canal_venta,
  fulfillment_channel,
  source,
  marketplace_country,
  COUNT(*) AS filas,
  SUM(quantity) AS unidades
FROM public.amazon_all_orders_items
WHERE UPPER(COALESCE(canal_venta, '')) IN ('FBM', 'AMAZON')
   OR UPPER(COALESCE(fulfillment_channel, '')) LIKE '%MERCHANT%'
   OR UPPER(COALESCE(fulfillment_channel, '')) LIKE '%MFN%'
   OR UPPER(COALESCE(fulfillment_channel, '')) LIKE '%FBM%'
GROUP BY canal_venta, fulfillment_channel, source, marketplace_country
ORDER BY unidades DESC NULLS LAST;

-- =============================================================================
-- 08 — resumen FBA vs FBM en ventas_diarias (últimos 90 días)
-- =============================================================================
SELECT
  '08_ventas_ultimos_90d_por_canal' AS seccion,
  canal_venta,
  source,
  COUNT(*) AS filas,
  SUM(unidades_vendidas) AS unidades
FROM public.ventas_diarias
WHERE fecha >= (CURRENT_DATE - INTERVAL '90 days')
GROUP BY canal_venta, source
ORDER BY canal_venta, unidades DESC NULLS LAST;

-- =============================================================================
-- 09 — ventas_diarias con source NULL (legacy)
-- =============================================================================
SELECT
  '09_ventas_source_null_legacy' AS seccion,
  canal_venta,
  COUNT(*) AS filas,
  SUM(unidades_vendidas) AS unidades,
  MIN(fecha) AS primera_fecha,
  MAX(fecha) AS ultima_fecha
FROM public.ventas_diarias
WHERE source IS NULL
GROUP BY canal_venta
ORDER BY unidades DESC NULLS LAST;

-- =============================================================================
-- 10 — funciones SQL que escriben ventas_diarias (catálogo)
-- =============================================================================
SELECT
  '10_funciones_sync_ventas' AS seccion,
  n.nspname AS schema,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname ILIKE '%ventas_diarias%'
    OR p.proname ILIKE '%all_order%'
    OR p.proname ILIKE '%fba_sales%'
    OR p.proname ILIKE '%payments%'
  )
ORDER BY p.proname;
