-- Diagnostics for SP-API FBA sales -> ventas_diarias.
-- Adjust the params CTE before running.

WITH params AS (
  SELECT
    DATE '2026-07-01' AS start_date,
    DATE '2026-07-09' AS end_date,
    'spapi_fba_customer_shipment_sales'::text AS source
),
view_totals AS (
  SELECT
    v.fecha,
    v.pais,
    v.marketplace_id,
    v.producto_id,
    v.canal_venta,
    v.moneda,
    SUM(v.unidades_vendidas) AS unidades,
    SUM(v.ingresos_brutos) AS ingresos
  FROM public.v_amazon_fba_sales_daily v, params p
  WHERE v.fecha >= p.start_date
    AND v.fecha < p.end_date
  GROUP BY 1, 2, 3, 4, 5, 6
),
ventas_totals AS (
  SELECT
    vd.fecha,
    vd.pais,
    vd.marketplace_id,
    vd.producto_id,
    vd.canal_venta,
    vd.moneda,
    SUM(vd.unidades_vendidas) AS unidades,
    SUM(vd.ingresos_brutos) AS ingresos
  FROM public.ventas_diarias vd, params p
  WHERE vd.fecha >= p.start_date
    AND vd.fecha < p.end_date
    AND vd.source = p.source
  GROUP BY 1, 2, 3, 4, 5, 6
)
SELECT
  COALESCE(v.fecha, vd.fecha) AS fecha,
  COALESCE(v.pais, vd.pais) AS pais,
  COALESCE(v.marketplace_id, vd.marketplace_id) AS marketplace_id,
  COALESCE(v.producto_id, vd.producto_id) AS producto_id,
  COALESCE(v.unidades, 0) AS vista_unidades,
  COALESCE(vd.unidades, 0) AS ventas_diarias_unidades,
  COALESCE(v.ingresos, 0) AS vista_ingresos,
  COALESCE(vd.ingresos, 0) AS ventas_diarias_ingresos
FROM view_totals v
FULL OUTER JOIN ventas_totals vd
  ON vd.producto_id = v.producto_id
 AND vd.fecha = v.fecha
 AND vd.pais = v.pais
 AND vd.canal_venta = v.canal_venta
 AND vd.moneda = v.moneda
 AND vd.marketplace_id = v.marketplace_id
ORDER BY fecha DESC, pais, marketplace_id, producto_id;

-- Potential duplicates at the ventas_diarias grain used by this sync.
WITH params AS (
  SELECT DATE '2026-07-01' AS start_date, DATE '2026-07-09' AS end_date
)
SELECT
  producto_id,
  fecha,
  pais,
  canal_venta,
  moneda,
  marketplace_id,
  tipo_cliente,
  source,
  COUNT(*) AS rows_count,
  SUM(unidades_vendidas) AS unidades
FROM public.ventas_diarias vd, params p
WHERE vd.fecha >= p.start_date
  AND vd.fecha < p.end_date
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
ORDER BY rows_count DESC, fecha DESC;

-- Active sources in ventas_diarias.
SELECT
  source,
  COUNT(*) AS rows_count,
  SUM(unidades_vendidas) AS unidades
FROM public.ventas_diarias
GROUP BY source
ORDER BY source;

-- FBA raw rows without product mapping. These cannot enter Inventory/Forecast.
WITH params AS (
  SELECT DATE '2026-07-01' AS start_date, DATE '2026-07-09' AS end_date
)
SELECT
  sale_date AS fecha,
  COALESCE(NULLIF(ship_to_country, ''), 'UNKNOWN') AS pais,
  marketplace_id,
  sku_limpio,
  sku_original,
  COUNT(*) AS orphan_rows,
  SUM(quantity) AS orphan_units
FROM public.amazon_fba_sales_daily_raw r, params p
WHERE r.sale_date >= p.start_date
  AND r.sale_date < p.end_date
  AND r.producto_id IS NULL
  AND COALESCE(r.quantity, 0) <> 0
GROUP BY 1, 2, 3, 4, 5
ORDER BY orphan_units DESC, fecha DESC;

-- Last 30/90 days by country for the synced FBA source.
SELECT
  pais,
  SUM(unidades_vendidas) FILTER (WHERE fecha >= current_date - INTERVAL '30 days') AS unidades_30d,
  SUM(unidades_vendidas) FILTER (WHERE fecha >= current_date - INTERVAL '90 days') AS unidades_90d,
  SUM(ingresos_brutos) FILTER (WHERE fecha >= current_date - INTERVAL '30 days') AS ingresos_30d,
  SUM(ingresos_brutos) FILTER (WHERE fecha >= current_date - INTERVAL '90 days') AS ingresos_90d
FROM public.ventas_diarias
WHERE source = 'spapi_fba_customer_shipment_sales'
  AND fecha >= current_date - INTERVAL '90 days'
GROUP BY pais
ORDER BY unidades_90d DESC NULLS LAST, pais;
