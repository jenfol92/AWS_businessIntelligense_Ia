-- Diagnostico: demanda FBA por marketplace de venta vs pais de entrega.
-- Caso de referencia:
-- producto_id 614e8e63-b23a-4c4f-8915-abf19a86702f
-- rango [2026-06-13, 2026-07-14)

-- A) Por marketplace de venta (raw sales-channel).
SELECT
  raw->>'sales-channel' AS sales_channel,
  COUNT(*) AS filas,
  SUM(quantity) AS unidades,
  SUM(amount) AS importe
FROM public.amazon_fba_sales_daily_raw
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND sale_date >= '2026-06-13'
  AND sale_date < '2026-07-14'
  AND raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
GROUP BY raw->>'sales-channel'
ORDER BY unidades DESC;

-- B) Por pais de entrega del cliente.
SELECT
  CASE
    WHEN ship_to_country IS NULL OR trim(ship_to_country) = '' OR trim(ship_to_country) = '--'
    THEN 'UNKNOWN'
    ELSE upper(trim(ship_to_country))
  END AS ship_country,
  COUNT(*) AS filas,
  SUM(quantity) AS unidades,
  SUM(amount) AS importe
FROM public.amazon_fba_sales_daily_raw
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND sale_date >= '2026-06-13'
  AND sale_date < '2026-07-14'
  AND raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
GROUP BY 1
ORDER BY unidades DESC;

-- C) Cruce marketplace de venta vs pais de entrega.
SELECT
  raw->>'sales-channel' AS sales_channel,
  CASE
    WHEN ship_to_country IS NULL OR trim(ship_to_country) = '' OR trim(ship_to_country) = '--'
    THEN 'UNKNOWN'
    ELSE upper(trim(ship_to_country))
  END AS ship_country,
  COUNT(*) AS filas,
  SUM(quantity) AS unidades,
  SUM(amount) AS importe
FROM public.amazon_fba_sales_daily_raw
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND sale_date >= '2026-06-13'
  AND sale_date < '2026-07-14'
  AND raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
GROUP BY raw->>'sales-channel', 2
ORDER BY sales_channel, unidades DESC;

-- D) Auditoria de marketplace_id historico. Si aparece un unico valor para
-- varios sales-channel, no usar marketplace_id para demanda marketplace.
SELECT
  marketplace_id,
  raw->>'sales-channel' AS sales_channel,
  COUNT(*) AS filas,
  SUM(quantity) AS unidades
FROM public.amazon_fba_sales_daily_raw
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND sale_date >= '2026-06-13'
  AND sale_date < '2026-07-14'
  AND raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
GROUP BY marketplace_id, raw->>'sales-channel'
ORDER BY sales_channel, marketplace_id;
