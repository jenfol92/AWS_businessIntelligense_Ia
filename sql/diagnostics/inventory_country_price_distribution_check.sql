-- Diagnostico: precio top real por producto/pais/canal para Inventario.
-- No usa ventas_diarias.ingresos_brutos / unidades_vendidas como precio.
-- Editar params antes de ejecutar.

WITH params AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid AS product_id,
    'ES'::text AS country,
    'ALL'::text AS channel_scope
),
raw_prices AS (
  SELECT
    f.producto_id,
    COALESCE(NULLIF(f.ship_to_country, ''), 'UNKNOWN') AS country,
    'FBA'::text AS channel,
    'spapi_fba_customer_shipment_sales'::text AS source,
    'amazon_fba_sales_daily_raw.amount / quantity'::text AS price_basis,
    f.sale_date::date AS sale_date,
    f.quantity::numeric AS units,
    f.amount::numeric AS gross_amount,
    ROUND((f.amount::numeric / NULLIF(f.quantity::numeric, 0)), 2) AS unit_price
  FROM amazon_fba_sales_daily_raw f
  CROSS JOIN params p
  WHERE f.producto_id = p.product_id
    AND COALESCE(NULLIF(f.ship_to_country, ''), 'UNKNOWN') = p.country
    AND (p.channel_scope IN ('ALL', 'FBA'))
    AND f.amount IS NOT NULL
    AND COALESCE(f.quantity, 0) <> 0
    AND COALESCE(
      NULLIF(f.raw->>'report_type', ''),
      'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
    ) = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'

  UNION ALL

  SELECT
    s.producto_id,
    COALESCE(NULLIF(s.country, ''), 'UNKNOWN') AS country,
    'FBM'::text AS channel,
    'stockagile_fbm_sales'::text AS source,
    'stockagile_orders_raw.gross_amount / quantity'::text AS price_basis,
    s.order_date::date AS sale_date,
    s.quantity::numeric AS units,
    s.gross_amount::numeric AS gross_amount,
    ROUND((s.gross_amount::numeric / NULLIF(s.quantity::numeric, 0)), 2) AS unit_price
  FROM stockagile_orders_raw s
  CROSS JOIN params p
  WHERE s.source = 'stockagile_fbm_sales'
    AND s.is_twinly IS TRUE
    AND s.producto_id = p.product_id
    AND COALESCE(NULLIF(s.country, ''), 'UNKNOWN') = p.country
    AND (p.channel_scope IN ('ALL', 'FBM'))
    AND s.gross_amount IS NOT NULL
    AND COALESCE(s.quantity, 0) <> 0
),
windows AS (
  SELECT 30 AS window_days
  UNION ALL
  SELECT 90 AS window_days
),
distribution AS (
  SELECT
    w.window_days,
    r.country,
    r.channel,
    r.source,
    r.price_basis,
    r.unit_price,
    SUM(r.units) AS units,
    SUM(r.gross_amount) AS gross_amount,
    MAX(r.sale_date) AS last_sale_date
  FROM windows w
  JOIN raw_prices r
    ON r.sale_date >= CURRENT_DATE - (w.window_days || ' days')::interval
  GROUP BY
    w.window_days,
    r.country,
    r.channel,
    r.source,
    r.price_basis,
    r.unit_price
),
ranked AS (
  SELECT
    d.*,
    ROUND(
      100 * d.units / NULLIF(SUM(d.units) OVER (PARTITION BY d.window_days, d.country), 0),
      2
    ) AS percentage_units,
    ROW_NUMBER() OVER (
      PARTITION BY d.window_days, d.country
      ORDER BY d.units DESC, d.gross_amount DESC, d.last_sale_date DESC, d.unit_price DESC
    ) AS price_rank
  FROM distribution d
),
availability AS (
  SELECT
    p.product_id,
    p.country,
    p.channel_scope,
    COUNT(*) FILTER (WHERE r.sale_date >= CURRENT_DATE - INTERVAL '30 days') AS raw_price_rows_30d,
    COALESCE(SUM(r.units) FILTER (WHERE r.sale_date >= CURRENT_DATE - INTERVAL '30 days'), 0) AS raw_price_units_30d,
    COUNT(*) FILTER (WHERE r.sale_date >= CURRENT_DATE - INTERVAL '90 days') AS raw_price_rows_90d,
    COALESCE(SUM(r.units) FILTER (WHERE r.sale_date >= CURRENT_DATE - INTERVAL '90 days'), 0) AS raw_price_units_90d
  FROM params p
  LEFT JOIN raw_prices r ON TRUE
  GROUP BY p.product_id, p.country, p.channel_scope
)
SELECT
  'SUMMARY' AS section,
  NULL::int AS window_days,
  a.country,
  a.channel_scope AS channel,
  NULL::text AS source,
  NULL::text AS price_basis,
  NULL::numeric AS unit_price,
  a.raw_price_units_30d AS units_30d,
  a.raw_price_units_90d AS units_90d,
  NULL::numeric AS gross_amount,
  NULL::numeric AS percentage_units,
  NULL::date AS last_sale_date,
  CASE
    WHEN a.raw_price_rows_90d = 0 THEN 'NO_REAL_PRICE_AVAILABLE'
    ELSE 'REAL_PRICE_AVAILABLE'
  END AS diagnostic
FROM availability a

UNION ALL

SELECT
  'DISTRIBUTION' AS section,
  r.window_days,
  r.country,
  r.channel,
  r.source,
  r.price_basis,
  r.unit_price,
  CASE WHEN r.window_days = 30 THEN r.units ELSE NULL END AS units_30d,
  CASE WHEN r.window_days = 90 THEN r.units ELSE NULL END AS units_90d,
  r.gross_amount,
  r.percentage_units,
  r.last_sale_date,
  CASE WHEN r.price_rank = 1 THEN 'TOP_PRICE' ELSE 'PRICE_BUCKET' END AS diagnostic
FROM ranked r
ORDER BY section DESC, window_days NULLS FIRST, units_90d DESC NULLS LAST, units_30d DESC NULLS LAST;
