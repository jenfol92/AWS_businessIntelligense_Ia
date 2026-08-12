-- Diagnostico Stockagile FBM Twinly -> ventas_diarias.
-- No escribe datos. Ajustar params si se quiere acotar por fechas.

WITH params AS (
  SELECT
    NULL::date AS start_date,
    NULL::date AS end_date,
    'stockagile_fbm_sales'::text AS source,
    50::integer AS top_limit
),
raw_scoped AS (
  SELECT r.*
  FROM public.stockagile_orders_raw r
  CROSS JOIN params p
  WHERE r.source = p.source
    AND (p.start_date IS NULL OR r.order_date >= p.start_date)
    AND (p.end_date IS NULL OR r.order_date < p.end_date)
)
SELECT
  '01_raw_stockagile_total' AS seccion,
  jsonb_build_object(
    'rows', COUNT(*),
    'units', COALESCE(SUM(COALESCE(quantity, 0)), 0),
    'gross_amount', COALESCE(SUM(COALESCE(gross_amount, 0)), 0)
  ) AS resultado
FROM raw_scoped

UNION ALL

SELECT
  '02_raw_twinly' AS seccion,
  jsonb_build_object(
    'rows', COUNT(*),
    'units', COALESCE(SUM(COALESCE(quantity, 0)), 0),
    'gross_amount', COALESCE(SUM(COALESCE(gross_amount, 0)), 0)
  ) AS resultado
FROM raw_scoped
WHERE is_twinly = true
  AND ean_twinly IS NOT NULL

UNION ALL

SELECT
  '03_raw_no_twinly_omitido' AS seccion,
  jsonb_build_object(
    'rows', COUNT(*),
    'units', COALESCE(SUM(COALESCE(quantity, 0)), 0),
    'gross_amount', COALESCE(SUM(COALESCE(gross_amount, 0)), 0)
  ) AS resultado
FROM raw_scoped
WHERE COALESCE(is_twinly, false) = false
   OR omit_reason = 'NON_TWINLY'

UNION ALL

SELECT
  '04_twinly_sin_producto_id' AS seccion,
  jsonb_build_object(
    'rows', COUNT(*),
    'units', COALESCE(SUM(COALESCE(quantity, 0)), 0),
    'gross_amount', COALESCE(SUM(COALESCE(gross_amount, 0)), 0)
  ) AS resultado
FROM raw_scoped
WHERE is_twinly = true
  AND ean_twinly IS NOT NULL
  AND producto_id IS NULL

UNION ALL

SELECT
  '05_unit_price_null' AS seccion,
  jsonb_build_object(
    'rows', COUNT(*),
    'units', COALESCE(SUM(COALESCE(quantity, 0)), 0),
    'gross_amount', COALESCE(SUM(COALESCE(gross_amount, 0)), 0)
  ) AS resultado
FROM raw_scoped
WHERE unit_price IS NULL

UNION ALL

SELECT
  '06_price_distribution_by_ean_twinly' AS seccion,
  COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.units DESC, x.rows DESC), '[]'::jsonb) AS resultado
FROM (
  SELECT
    ean_twinly,
    unit_price,
    COUNT(*) AS rows,
    COALESCE(SUM(COALESCE(quantity, 0)), 0)::integer AS units,
    COALESCE(SUM(COALESCE(gross_amount, 0)), 0)::numeric AS gross_amount,
    MIN(order_date) AS first_date,
    MAX(order_date) AS last_date
  FROM raw_scoped
  WHERE ean_twinly IS NOT NULL
    AND unit_price IS NOT NULL
  GROUP BY ean_twinly, unit_price
  ORDER BY units DESC, rows DESC
  LIMIT (SELECT top_limit FROM params)
) x

UNION ALL

SELECT
  '07_top_unit_price_by_units' AS seccion,
  COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.units DESC, x.gross_amount DESC), '[]'::jsonb) AS resultado
FROM (
  SELECT
    ean_twinly,
    unit_price,
    COUNT(*) AS rows,
    COALESCE(SUM(COALESCE(quantity, 0)), 0)::integer AS units,
    COALESCE(SUM(COALESCE(gross_amount, 0)), 0)::numeric AS gross_amount,
    ROUND(
      100 * COALESCE(SUM(COALESCE(quantity, 0)), 0)::numeric
        / NULLIF(SUM(SUM(COALESCE(quantity, 0))) OVER (), 0),
      2
    ) AS pct_units,
    MAX(order_date) AS last_date
  FROM raw_scoped
  WHERE unit_price IS NOT NULL
  GROUP BY ean_twinly, unit_price
  ORDER BY units DESC, gross_amount DESC
  LIMIT (SELECT top_limit FROM params)
) x

UNION ALL

SELECT
  '08_top_sku_original_omitidos' AS seccion,
  COALESCE(jsonb_agg(to_jsonb(x) ORDER BY units DESC, rows DESC), '[]'::jsonb) AS resultado
FROM (
  SELECT
    sku_original,
    omit_reason,
    COUNT(*) AS rows,
    COALESCE(SUM(COALESCE(quantity, 0)), 0)::integer AS units,
    MIN(order_date) AS first_date,
    MAX(order_date) AS last_date
  FROM raw_scoped
  WHERE omit_reason IS NOT NULL
     OR producto_id IS NULL
  GROUP BY sku_original, omit_reason
  ORDER BY units DESC, rows DESC
  LIMIT (SELECT top_limit FROM params)
) x

UNION ALL

SELECT
  '09_top_sku_limpio_omitidos' AS seccion,
  COALESCE(jsonb_agg(to_jsonb(x) ORDER BY units DESC, rows DESC), '[]'::jsonb) AS resultado
FROM (
  SELECT
    sku_limpio,
    omit_reason,
    COUNT(*) AS rows,
    COALESCE(SUM(COALESCE(quantity, 0)), 0)::integer AS units,
    MIN(order_date) AS first_date,
    MAX(order_date) AS last_date
  FROM raw_scoped
  WHERE omit_reason IS NOT NULL
     OR producto_id IS NULL
  GROUP BY sku_limpio, omit_reason
  ORDER BY units DESC, rows DESC
  LIMIT (SELECT top_limit FROM params)
) x

UNION ALL

SELECT
  '10_top_ean_twinly_omitidos' AS seccion,
  COALESCE(jsonb_agg(to_jsonb(x) ORDER BY units DESC, rows DESC), '[]'::jsonb) AS resultado
FROM (
  SELECT
    ean_twinly,
    omit_reason,
    COUNT(*) AS rows,
    COALESCE(SUM(COALESCE(quantity, 0)), 0)::integer AS units,
    MIN(order_date) AS first_date,
    MAX(order_date) AS last_date
  FROM raw_scoped
  WHERE ean_twinly IS NOT NULL
    AND (omit_reason IS NOT NULL OR producto_id IS NULL)
  GROUP BY ean_twinly, omit_reason
  ORDER BY units DESC, rows DESC
  LIMIT (SELECT top_limit FROM params)
) x

UNION ALL

SELECT
  '11_ventas_diarias_stockagile_fbm' AS seccion,
  jsonb_build_object(
    'rows', COUNT(*),
    'units', COALESCE(SUM(COALESCE(unidades_vendidas, 0)), 0),
    'gross_amount', COALESCE(SUM(COALESCE(ingresos_brutos, 0)), 0)
  ) AS resultado
FROM public.ventas_diarias vd
CROSS JOIN params p
WHERE vd.source = p.source
  AND vd.canal_venta = 'FBM'
  AND (p.start_date IS NULL OR vd.fecha >= p.start_date)
  AND (p.end_date IS NULL OR vd.fecha < p.end_date)

UNION ALL

SELECT
  '12_duplicados_stockagile_raw' AS seccion,
  COALESCE(jsonb_agg(to_jsonb(x) ORDER BY rows DESC), '[]'::jsonb) AS resultado
FROM (
  SELECT
    dedupe_key,
    COUNT(*) AS rows,
    SUM(quantity) AS units
  FROM raw_scoped
  GROUP BY dedupe_key
  HAVING COUNT(*) > 1
  ORDER BY rows DESC
  LIMIT (SELECT top_limit FROM params)
) x

UNION ALL

SELECT
  '13_conflictos_amazon_all_orders_fbm' AS seccion,
  COALESCE(jsonb_agg(to_jsonb(x) ORDER BY stockagile_units DESC), '[]'::jsonb) AS resultado
FROM (
  SELECT
    s.producto_id,
    s.order_date,
    s.country,
    s.currency,
    SUM(s.quantity) AS stockagile_units,
    SUM(a.quantity) AS all_orders_units,
    COUNT(*) AS joined_rows
  FROM raw_scoped s
  JOIN public.amazon_all_orders_items a
    ON a.producto_id = s.producto_id
   AND a.purchase_date = s.order_date
   AND COALESCE(a.marketplace_country, '') = COALESCE(s.country, '')
   AND COALESCE(a.currency, '') = COALESCE(s.currency, '')
   AND COALESCE(a.canal_venta, '') = 'FBM'
  WHERE s.producto_id IS NOT NULL
  GROUP BY s.producto_id, s.order_date, s.country, s.currency
  ORDER BY stockagile_units DESC
  LIMIT (SELECT top_limit FROM params)
) x;
