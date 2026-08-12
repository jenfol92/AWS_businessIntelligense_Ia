-- Auditoría: diferencia ventas Amazon Seller Central vs pantalla Inventario (V.30d / V.90d)
-- SELECT-only. Sustituir valores en el bloque params antes de ejecutar.
--
-- Parámetros manuales:
--   :PRODUCT_ID  -> producto_id visible en la URL / detalle Inventario
--   :SKU         -> SKU principal del producto (ej. del catálogo)
--   :SKU_PATTERN -> fragmento para buscar SKUs relacionados (ej. EAN parcial)
--   :DATE_FROM_30 -> current_date - 30
--   :DATE_FROM_90 -> current_date - 90
--   :DATE_TO      -> current_date + 1  (límite exclusivo)

WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    '843661661'::text AS sku,
    '843661661'::text AS sku_pattern,
    (current_date - interval '30 days')::date AS date_from_30,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
)

-- =============================================================================
-- A) Identificar producto seleccionado en Inventario
-- =============================================================================
SELECT
  p.id,
  p.sku,
  p.nombre,
  p.asin,
  pl.ean_upc AS ean,
  p.parent_id,
  parent.sku AS parent_sku,
  p.estado
FROM params x
JOIN productos p ON p.id = x.product_id
LEFT JOIN productos parent ON parent.id = p.parent_id
LEFT JOIN LATERAL (
  SELECT ean_upc
  FROM producto_logistica pl
  WHERE pl.producto_id = p.id
  ORDER BY pl.updated_at DESC NULLS LAST
  LIMIT 1
) pl ON true;

-- =============================================================================
-- B) Variantes / hermanos por parent_id, SKU o ASIN
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    '843661661'::text AS sku
)
SELECT
  p.id,
  p.sku,
  p.nombre,
  p.asin,
  pl.ean_upc AS ean,
  p.parent_id,
  parent.sku AS parent_sku,
  p.estado
FROM params x
JOIN productos anchor ON anchor.id = x.product_id
JOIN productos p ON (
  p.id = anchor.id
  OR p.parent_id = anchor.id
  OR p.id = anchor.parent_id
  OR (anchor.parent_id IS NOT NULL AND p.parent_id = anchor.parent_id)
  OR p.sku = x.sku
  OR p.sku ILIKE '%' || x.sku || '%'
  OR (anchor.asin IS NOT NULL AND p.asin = anchor.asin)
)
LEFT JOIN productos parent ON parent.id = p.parent_id
LEFT JOIN LATERAL (
  SELECT ean_upc
  FROM producto_logistica pl
  WHERE pl.producto_id = p.id
  ORDER BY pl.updated_at DESC NULLS LAST
  LIMIT 1
) pl ON true
ORDER BY p.sku;

-- =============================================================================
-- C) Raw FBA (GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL) por producto_id, 30d
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    (current_date - interval '30 days')::date AS date_from_30,
    (current_date + interval '1 day')::date AS date_to
)
SELECT
  r.producto_id,
  r.sku_original,
  r.sku_limpio,
  r.ship_to_country,
  r.raw->>'sales-channel' AS sales_channel,
  r.currency,
  COUNT(*) AS filas,
  SUM(r.quantity) AS unidades,
  SUM(r.amount) AS amount_total
FROM params x
JOIN amazon_fba_sales_daily_raw r ON r.producto_id = x.product_id
WHERE r.sale_date >= x.date_from_30
  AND r.sale_date < x.date_to
  AND r.raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
GROUP BY
  r.producto_id,
  r.sku_original,
  r.sku_limpio,
  r.ship_to_country,
  r.raw->>'sales-channel',
  r.currency
ORDER BY unidades DESC;

-- =============================================================================
-- D) Raw FBA por producto_id, 90d
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
)
SELECT
  r.producto_id,
  r.sku_original,
  r.sku_limpio,
  r.ship_to_country,
  r.raw->>'sales-channel' AS sales_channel,
  r.currency,
  COUNT(*) AS filas,
  SUM(r.quantity) AS unidades,
  SUM(r.amount) AS amount_total
FROM params x
JOIN amazon_fba_sales_daily_raw r ON r.producto_id = x.product_id
WHERE r.sale_date >= x.date_from_90
  AND r.sale_date < x.date_to
  AND r.raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
GROUP BY
  r.producto_id,
  r.sku_original,
  r.sku_limpio,
  r.ship_to_country,
  r.raw->>'sales-channel',
  r.currency
ORDER BY unidades DESC;

-- =============================================================================
-- E) ventas_diarias (source FBA SP-API) por producto_id, 30d
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    (current_date - interval '30 days')::date AS date_from_30,
    (current_date + interval '1 day')::date AS date_to
)
SELECT
  vd.producto_id,
  vd.pais,
  vd.canal_venta,
  vd.marketplace_id,
  vd.moneda,
  vd.source,
  COUNT(*) AS filas,
  SUM(vd.unidades_vendidas) AS unidades,
  SUM(vd.ingresos_brutos) AS ingresos
FROM params x
JOIN ventas_diarias vd ON vd.producto_id = x.product_id
WHERE vd.fecha >= x.date_from_30
  AND vd.fecha < x.date_to
  AND vd.source = 'spapi_fba_customer_shipment_sales'
GROUP BY
  vd.producto_id,
  vd.pais,
  vd.canal_venta,
  vd.marketplace_id,
  vd.moneda,
  vd.source
ORDER BY unidades DESC;

-- =============================================================================
-- F) ventas_diarias (source FBA SP-API) por producto_id, 90d
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
)
SELECT
  vd.producto_id,
  vd.pais,
  vd.canal_venta,
  vd.marketplace_id,
  vd.moneda,
  vd.source,
  COUNT(*) AS filas,
  SUM(vd.unidades_vendidas) AS unidades,
  SUM(vd.ingresos_brutos) AS ingresos
FROM params x
JOIN ventas_diarias vd ON vd.producto_id = x.product_id
WHERE vd.fecha >= x.date_from_90
  AND vd.fecha < x.date_to
  AND vd.source = 'spapi_fba_customer_shipment_sales'
GROUP BY
  vd.producto_id,
  vd.pais,
  vd.canal_venta,
  vd.marketplace_id,
  vd.moneda,
  vd.source
ORDER BY unidades DESC;

-- =============================================================================
-- G) Comparar raw vs ventas_diarias por país (90d)
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
),
raw_sales AS (
  SELECT
    CASE
      WHEN r.ship_to_country IS NULL
        OR TRIM(r.ship_to_country) = ''
        OR TRIM(r.ship_to_country) = '--'
      THEN 'UNKNOWN'
      ELSE UPPER(TRIM(r.ship_to_country))
    END AS pais,
    SUM(r.quantity) AS raw_units
  FROM params x
  JOIN amazon_fba_sales_daily_raw r ON r.producto_id = x.product_id
  WHERE r.sale_date >= x.date_from_90
    AND r.sale_date < x.date_to
    AND r.raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
  GROUP BY 1
),
vd_sales AS (
  SELECT
    vd.pais,
    SUM(vd.unidades_vendidas) AS vd_units
  FROM params x
  JOIN ventas_diarias vd ON vd.producto_id = x.product_id
  WHERE vd.fecha >= x.date_from_90
    AND vd.fecha < x.date_to
    AND vd.source = 'spapi_fba_customer_shipment_sales'
  GROUP BY vd.pais
)
SELECT
  COALESCE(r.pais, v.pais) AS pais,
  COALESCE(r.raw_units, 0) AS raw_units,
  COALESCE(v.vd_units, 0) AS ventas_diarias_units,
  COALESCE(r.raw_units, 0) - COALESCE(v.vd_units, 0) AS diff
FROM raw_sales r
FULL JOIN vd_sales v ON v.pais = r.pais
ORDER BY ABS(COALESCE(r.raw_units, 0) - COALESCE(v.vd_units, 0)) DESC;

-- =============================================================================
-- H) Orphans (producto_id NULL) del SKU / patrón, 90d
-- =============================================================================
WITH params AS (
  SELECT
    '843661661'::text AS sku,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
)
SELECT
  r.sku_original,
  r.sku_limpio,
  r.ship_to_country,
  r.raw->>'sales-channel' AS sales_channel,
  COUNT(*) AS filas,
  SUM(r.quantity) AS unidades,
  SUM(r.amount) AS amount_total
FROM params x
JOIN amazon_fba_sales_daily_raw r ON r.producto_id IS NULL
WHERE r.sale_date >= x.date_from_90
  AND r.sale_date < x.date_to
  AND r.raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
  AND (
    r.sku_original ILIKE '%' || x.sku || '%'
    OR r.sku_limpio ILIKE '%' || x.sku || '%'
  )
GROUP BY
  r.sku_original,
  r.sku_limpio,
  r.ship_to_country,
  r.raw->>'sales-channel'
ORDER BY unidades DESC;

-- =============================================================================
-- I) Todos los SKUs relacionados por patrón (90d), con producto_id
-- =============================================================================
WITH params AS (
  SELECT
    '843661661'::text AS sku_pattern,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
)
SELECT
  r.producto_id,
  r.sku_original,
  r.sku_limpio,
  COUNT(*) AS filas,
  SUM(r.quantity) AS unidades,
  MIN(r.sale_date) AS primera_venta,
  MAX(r.sale_date) AS ultima_venta
FROM params x
JOIN amazon_fba_sales_daily_raw r ON true
WHERE r.sale_date >= x.date_from_90
  AND r.sale_date < x.date_to
  AND r.raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
  AND (
    r.sku_original ILIKE '%' || x.sku_pattern || '%'
    OR r.sku_limpio ILIKE '%' || x.sku_pattern || '%'
  )
GROUP BY r.producto_id, r.sku_original, r.sku_limpio
ORDER BY unidades DESC;

-- =============================================================================
-- J) Países con stock actual en inventario_paises (lo que puede mostrar la UI)
-- =============================================================================
WITH params AS (
  SELECT 'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id
)
SELECT
  ip.producto_id,
  ip.pais,
  ip.stock_fba,
  ip.stock_fbm,
  ip.stock_pais,
  ip.updated_at
FROM params x
JOIN inventario_paises ip ON ip.producto_id = x.product_id
ORDER BY ip.pais;

-- =============================================================================
-- K) Ventas en países que NO tienen fila en inventario_paises (ocultos en tabla UI)
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
),
sales_countries AS (
  SELECT
    vd.pais,
    SUM(vd.unidades_vendidas) AS unidades_90d
  FROM params x
  JOIN ventas_diarias vd ON vd.producto_id = x.product_id
  WHERE vd.fecha >= x.date_from_90
    AND vd.fecha < x.date_to
    AND vd.source = 'spapi_fba_customer_shipment_sales'
  GROUP BY vd.pais
),
stock_countries AS (
  SELECT DISTINCT ip.pais
  FROM params x
  JOIN inventario_paises ip ON ip.producto_id = x.product_id
)
SELECT
  s.pais,
  s.unidades_90d
FROM sales_countries s
LEFT JOIN stock_countries st ON st.pais = s.pais
WHERE st.pais IS NULL
ORDER BY s.unidades_90d DESC;

-- =============================================================================
-- L) Totales UI simulados: ventas_diarias SIN filtrar source (como fetchSalesAggregates)
--     vs solo source spapi_fba_customer_shipment_sales
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    (current_date - interval '30 days')::date AS date_from_30,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
)
SELECT
  'ventas_diarias ALL sources, canal FBA' AS scope,
  SUM(vd.unidades_vendidas) FILTER (
    WHERE vd.fecha >= x.date_from_30 AND vd.fecha < x.date_to
  ) AS units_30d,
  SUM(vd.unidades_vendidas) FILTER (
    WHERE vd.fecha >= x.date_from_90 AND vd.fecha < x.date_to
  ) AS units_90d
FROM params x
JOIN ventas_diarias vd ON vd.producto_id = x.product_id
WHERE vd.canal_venta = 'FBA'
UNION ALL
SELECT
  'ventas_diarias source=spapi_fba_customer_shipment_sales' AS scope,
  SUM(vd.unidades_vendidas) FILTER (
    WHERE vd.fecha >= x.date_from_30 AND vd.fecha < x.date_to
  ) AS units_30d,
  SUM(vd.unidades_vendidas) FILTER (
    WHERE vd.fecha >= x.date_from_90 AND vd.fecha < x.date_to
  ) AS units_90d
FROM params x
JOIN ventas_diarias vd ON vd.producto_id = x.product_id
WHERE vd.source = 'spapi_fba_customer_shipment_sales';

-- =============================================================================
-- M) Ventas familia (producto + parent + hermanos/hijos) vs solo producto_id
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    (current_date - interval '30 days')::date AS date_from_30,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
),
family AS (
  SELECT anchor.id AS producto_id, anchor.sku, 'selected'::text AS role
  FROM params x
  JOIN productos anchor ON anchor.id = x.product_id
  UNION
  SELECT p.id, p.sku, 'parent'::text
  FROM params x
  JOIN productos anchor ON anchor.id = x.product_id
  JOIN productos p ON p.id = anchor.parent_id
  UNION
  SELECT p.id, p.sku, 'sibling'::text
  FROM params x
  JOIN productos anchor ON anchor.id = x.product_id
  JOIN productos p ON p.parent_id = anchor.parent_id AND p.id <> anchor.id
  UNION
  SELECT p.id, p.sku, 'child'::text
  FROM params x
  JOIN productos anchor ON anchor.id = x.product_id
  JOIN productos p ON p.parent_id = anchor.id
)
SELECT
  f.role,
  f.producto_id,
  f.sku,
  SUM(vd.unidades_vendidas) FILTER (
    WHERE vd.fecha >= (SELECT date_from_30 FROM params)
      AND vd.fecha < (SELECT date_to FROM params)
      AND vd.source = 'spapi_fba_customer_shipment_sales'
  ) AS units_30d_spapi,
  SUM(vd.unidades_vendidas) FILTER (
    WHERE vd.fecha >= (SELECT date_from_90 FROM params)
      AND vd.fecha < (SELECT date_to FROM params)
      AND vd.source = 'spapi_fba_customer_shipment_sales'
  ) AS units_90d_spapi
FROM family f
LEFT JOIN ventas_diarias vd ON vd.producto_id = f.producto_id
GROUP BY f.role, f.producto_id, f.sku
ORDER BY f.role, f.sku;

-- =============================================================================
-- N) Suma visible UI (solo países con inventario_paises) vs total global 90d
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    (current_date - interval '30 days')::date AS date_from_30,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
),
by_country AS (
  SELECT
    vd.pais,
    SUM(vd.unidades_vendidas) FILTER (
      WHERE vd.fecha >= x.date_from_30 AND vd.fecha < x.date_to
    ) AS units_30d,
    SUM(vd.unidades_vendidas) FILTER (
      WHERE vd.fecha >= x.date_from_90 AND vd.fecha < x.date_to
    ) AS units_90d
  FROM params x
  JOIN ventas_diarias vd ON vd.producto_id = x.product_id
  WHERE vd.source = 'spapi_fba_customer_shipment_sales'
  GROUP BY vd.pais
),
stock_countries AS (
  SELECT ip.pais
  FROM params x
  JOIN inventario_paises ip ON ip.producto_id = x.product_id
)
SELECT
  'global_all_countries' AS metric,
  SUM(bc.units_30d) AS sum_30d,
  SUM(bc.units_90d) AS sum_90d
FROM by_country bc
UNION ALL
SELECT
  'visible_ui_countries_only' AS metric,
  SUM(bc.units_30d) AS sum_30d,
  SUM(bc.units_90d) AS sum_90d
FROM by_country bc
JOIN stock_countries sc ON sc.pais = bc.pais;

-- =============================================================================
-- O) Raw con report_type distinto (legacy) que NO entra en v_amazon_fba_sales_daily
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
)
SELECT
  r.raw->>'report_type' AS report_type,
  COUNT(*) AS filas,
  SUM(r.quantity) AS unidades
FROM params x
JOIN amazon_fba_sales_daily_raw r ON r.producto_id = x.product_id
WHERE r.sale_date >= x.date_from_90
  AND r.sale_date < x.date_to
GROUP BY r.raw->>'report_type'
ORDER BY unidades DESC;

-- =============================================================================
-- P) Cobertura temporal del import raw (¿hay huecos de fechas?)
-- =============================================================================
WITH params AS (
  SELECT
    'a2f34a83-a941-42fd-844e-8a51286e5216'::uuid AS product_id,
    (current_date - interval '90 days')::date AS date_from_90,
    (current_date + interval '1 day')::date AS date_to
)
SELECT
  MIN(r.sale_date) AS primera_fecha_raw,
  MAX(r.sale_date) AS ultima_fecha_raw,
  COUNT(DISTINCT r.sale_date) AS dias_con_venta,
  SUM(r.quantity) AS unidades_totales
FROM params x
JOIN amazon_fba_sales_daily_raw r ON r.producto_id = x.product_id
WHERE r.sale_date >= x.date_from_90
  AND r.sale_date < x.date_to
  AND r.raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL';
