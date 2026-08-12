-- Diagnostico SELECT-only: auditoria flujo stock FBA Amazon.
-- No modifica datos. Ejecutar en Supabase SQL editor.

-- 01) Productos auditados.
SELECT
  '01_productos' AS section,
  p.id,
  p.sku,
  p.nombre,
  p.estado,
  p.parent_id
FROM public.productos p
WHERE p.sku IN ('8436616610302', '8436616610104')
   OR p.nombre ILIKE '%Alaia%'
ORDER BY p.sku;

-- 02) Ultimos jobs SP-API BY_COUNTRY y estado de descarga/importacion.
SELECT
  '02_spapi_jobs_by_country' AS section,
  j.id,
  j.report_type,
  j.report_id,
  j.report_document_id,
  j.status,
  j.processing_status,
  j.marketplace_ids,
  j.requested_at,
  j.completed_at,
  j.downloaded_at,
  j.source,
  j.error_message,
  j.raw->>'importedAt' AS imported_at,
  j.raw->'importSummary' AS import_summary,
  j.raw->'lastPreviewSummary' AS last_preview_summary,
  j.raw->'lastReportSnapshot' AS last_report_snapshot
FROM public.amazon_spapi_report_jobs j
WHERE j.report_type = 'GET_AFN_INVENTORY_DATA_BY_COUNTRY'
ORDER BY j.requested_at DESC
LIMIT 20;

-- 03) Lineas crudas del ultimo documento BY_COUNTRY guardado para los SKUs auditados.
WITH latest_job AS (
  SELECT j.*
  FROM public.amazon_spapi_report_jobs j
  WHERE j.report_type = 'GET_AFN_INVENTORY_DATA_BY_COUNTRY'
    AND j.raw ? 'reportContent'
  ORDER BY j.requested_at DESC
  LIMIT 1
),
raw_lines AS (
  SELECT
    lj.id AS job_id,
    lj.report_id,
    lj.report_document_id,
    lj.requested_at,
    row_number() OVER () AS line_no,
    line
  FROM latest_job lj
  CROSS JOIN LATERAL regexp_split_to_table(lj.raw->>'reportContent', E'\r?\n') AS line
),
parsed AS (
  SELECT
    job_id,
    report_id,
    report_document_id,
    requested_at,
    line_no,
    line,
    string_to_array(line, E'\t') AS cols
  FROM raw_lines
  WHERE line LIKE '%8436616610302%'
     OR line LIKE '%8436616610104%'
)
SELECT
  '03_raw_latest_by_country_target_lines' AS section,
  job_id,
  report_id,
  report_document_id,
  requested_at,
  line_no,
  cols[1] AS seller_sku,
  substring(cols[1] FROM '(843661661[0-9]{4})') AS sku_limpio_extraido,
  cols[2] AS fulfillment_channel_sku,
  cols[3] AS asin,
  cols[4] AS condition_type,
  cols[5] AS country,
  NULLIF(cols[6], '')::integer AS quantity_for_local_fulfillment,
  line AS raw_line
FROM parsed
ORDER BY sku_limpio_extraido, country, seller_sku;

-- 04) Suma que aplica el parser/importador BY_COUNTRY: SKU limpio + pais.
WITH latest_job AS (
  SELECT j.*
  FROM public.amazon_spapi_report_jobs j
  WHERE j.report_type = 'GET_AFN_INVENTORY_DATA_BY_COUNTRY'
    AND j.raw ? 'reportContent'
  ORDER BY j.requested_at DESC
  LIMIT 1
),
lines AS (
  SELECT string_to_array(line, E'\t') AS cols
  FROM latest_job lj
  CROSS JOIN LATERAL regexp_split_to_table(lj.raw->>'reportContent', E'\r?\n') AS line
  WHERE line LIKE '%8436616610302%'
     OR line LIKE '%8436616610104%'
)
SELECT
  '04_parser_sum_latest_by_country' AS section,
  substring(cols[1] FROM '(843661661[0-9]{4})') AS sku_limpio,
  cols[5] AS country,
  COUNT(*) AS source_rows,
  SUM(NULLIF(cols[6], '')::integer) AS summed_quantity
FROM lines
WHERE substring(cols[1] FROM '(843661661[0-9]{4})') IS NOT NULL
GROUP BY substring(cols[1] FROM '(843661661[0-9]{4})'), cols[5]
ORDER BY sku_limpio, country;

-- 05) Estado actual de inventario_paises que reconstruye el 466.
SELECT
  '05_inventario_paises_actual' AS section,
  p.sku,
  i.id,
  i.producto_id,
  i.pais,
  i.stock_fba,
  i.stock_fbm,
  i.stock_pais,
  i.marketplace_id,
  i.updated_at
FROM public.inventario_paises i
JOIN public.productos p ON p.id = i.producto_id
WHERE p.sku IN ('8436616610302', '8436616610104')
ORDER BY p.sku, i.pais;

-- 06) Totales actuales en inventario_paises.
SELECT
  '06_inventario_paises_totales' AS section,
  p.sku,
  SUM(COALESCE(i.stock_fba, 0)) AS stock_fba_total,
  SUM(COALESCE(i.stock_fbm, 0)) AS stock_fbm_total,
  SUM(COALESCE(i.stock_fba, 0) + COALESCE(i.stock_fbm, 0)) AS stock_total
FROM public.inventario_paises i
JOIN public.productos p ON p.id = i.producto_id
WHERE p.sku IN ('8436616610302', '8436616610104')
GROUP BY p.sku
ORDER BY p.sku;

-- 07) Historico BY_COUNTRY persistido.
SELECT
  '07_fba_country_stock_daily' AS section,
  p.sku,
  h.id,
  h.producto_id,
  h.sku_limpio,
  h.marketplace_country,
  h.marketplace_id,
  h.snapshot_date,
  h.stock_fba,
  h.source,
  h.created_at,
  h.raw
FROM public.fba_country_stock_daily h
JOIN public.productos p ON p.id = h.producto_id
WHERE p.sku IN ('8436616610302', '8436616610104')
ORDER BY p.sku, h.snapshot_date DESC, h.marketplace_country;

-- 08) Ledger base usado por la tabla de Stock por pais.
SELECT
  '08_ledger_base_latest' AS section,
  p.sku,
  l.id,
  l.producto_id,
  l.sku_original,
  l.sku_limpio,
  l.fnsku,
  l.asin,
  l.snapshot_date,
  l.disposition,
  l.location,
  l.location_country,
  l.starting_warehouse_balance,
  l.ending_warehouse_balance,
  l.receipts,
  l.customer_shipments,
  l.customer_returns,
  l.source,
  l.source_file_name,
  l.created_at,
  l.updated_at,
  l.raw
FROM public.amazon_fba_inventory_ledger_daily l
JOIN public.productos p ON p.id = l.producto_id
WHERE p.sku IN ('8436616610302', '8436616610104')
  AND l.snapshot_date = (
    SELECT MAX(l2.snapshot_date)
    FROM public.amazon_fba_inventory_ledger_daily l2
    WHERE l2.producto_id = l.producto_id
  )
ORDER BY p.sku, l.location, l.disposition;

-- 09) Vista por pais que consume la UI de Inventario.
SELECT
  '09_v_latest_fba_inventory_by_product_country' AS section,
  p.sku,
  v.*
FROM public.v_latest_fba_inventory_by_product_country v
JOIN public.productos p ON p.id = v.producto_id
WHERE p.sku IN ('8436616610302', '8436616610104')
ORDER BY p.sku, v.pais;

-- 10) Vista/RPC de ledger total.
SELECT
  '10_v_product_fba_stock_daily_latest' AS section,
  p.sku,
  v.*
FROM public.v_product_fba_stock_daily v
JOIN public.productos p ON p.id = v.producto_id
WHERE p.sku IN ('8436616610302', '8436616610104')
ORDER BY p.sku, v.snapshot_date DESC;

-- 11) Snapshot operativo FBA Inventory API, si existe.
SELECT
  '11_v_latest_amazon_fba_inventory_snapshot' AS section,
  p.sku,
  v.*
FROM public.v_latest_amazon_fba_inventory_snapshot v
JOIN public.productos p ON p.id = v.producto_id
WHERE p.sku IN ('8436616610302', '8436616610104')
ORDER BY p.sku, v.snapshot_at DESC;

-- 12) Estado del cron de snapshot FBA Inventory API.
SELECT
  '12_amazon_sync_job_fba_inventory_snapshot' AS section,
  *
FROM public.amazon_sync_jobs
WHERE job_key = 'amazon_fba_inventory_snapshot';
