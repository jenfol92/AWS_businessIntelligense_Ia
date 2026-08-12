-- Diagnostico: Precio top de Inventario por marketplace de venta vs pais de entrega.
-- Producto de referencia: 614e8e63-b23a-4c4f-8915-abf19a86702f
--
-- Objetivo:
-- - Alinear Precio top 30d/90d con Ventas marketplace 30d/90d.
-- - Demostrar la diferencia entre agrupar por raw->>'sales-channel' y por ship_to_country.

-- A) Unidades por marketplace de venta.
SELECT
  raw->>'sales-channel' AS sales_channel,
  SUM(quantity) AS units,
  SUM(amount) AS amount
FROM amazon_fba_sales_daily_raw
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND sale_date >= CURRENT_DATE - INTERVAL '30 days'
  AND raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
GROUP BY raw->>'sales-channel'
ORDER BY units DESC;

-- B) Unidades por pais de entrega del cliente.
SELECT
  ship_to_country,
  SUM(quantity) AS units,
  SUM(amount) AS amount
FROM amazon_fba_sales_daily_raw
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND sale_date >= CURRENT_DATE - INTERVAL '30 days'
  AND raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
GROUP BY ship_to_country
ORDER BY units DESC;

-- C) Precio top por marketplace DE.
SELECT
  ROUND((amount / NULLIF(quantity, 0))::numeric, 2) AS unit_price,
  SUM(quantity) AS units,
  SUM(amount) AS gross_amount,
  MAX(sale_date) AS last_sale_date
FROM amazon_fba_sales_daily_raw
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND sale_date >= CURRENT_DATE - INTERVAL '30 days'
  AND raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
  AND raw->>'sales-channel' = 'amazon.de'
GROUP BY ROUND((amount / NULLIF(quantity, 0))::numeric, 2)
ORDER BY units DESC, gross_amount DESC;

-- D) Precio top por entrega DE, solo para demostrar la diferencia.
SELECT
  ROUND((amount / NULLIF(quantity, 0))::numeric, 2) AS unit_price,
  SUM(quantity) AS units,
  SUM(amount) AS gross_amount,
  MAX(sale_date) AS last_sale_date
FROM amazon_fba_sales_daily_raw
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND sale_date >= CURRENT_DATE - INTERVAL '30 days'
  AND raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
  AND ship_to_country = 'DE'
GROUP BY ROUND((amount / NULLIF(quantity, 0))::numeric, 2)
ORDER BY units DESC, gross_amount DESC;
