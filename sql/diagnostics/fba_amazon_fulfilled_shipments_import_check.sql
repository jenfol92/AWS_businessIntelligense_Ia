-- Diagnostico para FBA Sales operativo:
-- GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL -> amazon_fba_sales_daily_raw
-- source ventas_diarias = spapi_fba_customer_shipment_sales
-- No escribe datos.

-- A) report_type importado por marketplace/pais/canal.
SELECT
  raw->>'report_type' AS report_type,
  marketplace_id,
  ship_to_country,
  raw->>'sales-channel' AS sales_channel,
  COUNT(*) AS filas,
  SUM(quantity) AS unidades,
  SUM(amount) AS amount_total
FROM amazon_fba_sales_daily_raw
WHERE sale_date >= '2026-06-02'
  AND sale_date < '2026-07-03'
GROUP BY raw->>'report_type', marketplace_id, ship_to_country, raw->>'sales-channel'
ORDER BY ship_to_country;

-- B) pedido concreto validado contra Seller Central.
SELECT
  raw->>'amazon-order-id' AS amazon_order_id,
  sku_original,
  marketplace_id,
  ship_to_country,
  quantity,
  amount,
  currency,
  raw->>'item-price' AS item_price,
  raw->>'shipping-price' AS shipping_price,
  raw->>'ship-country' AS ship_country,
  raw->>'sales-channel' AS sales_channel,
  raw->>'report_type' AS report_type,
  raw
FROM amazon_fba_sales_daily_raw
WHERE raw->>'amazon-order-id' = '403-8390691-6119533';

-- Tras reimportar con GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL
-- este pedido debe mostrar ship_to_country = IT, ship_country = IT,
-- sales_channel = amazon.it e item_price = 45.00.

-- C) ventas_diarias generadas por el source operativo FBA.
SELECT
  pais,
  canal_venta,
  source,
  COUNT(*) AS filas,
  SUM(unidades_vendidas) AS unidades,
  SUM(ingresos_brutos) AS ingresos
FROM ventas_diarias
WHERE source = 'spapi_fba_customer_shipment_sales'
  AND fecha >= '2026-06-02'
  AND fecha < '2026-07-03'
GROUP BY pais, canal_venta, source
ORDER BY pais;

-- D) precio top por raw, sin ventas_diarias y sin mezclar variantes.
SELECT
  ship_to_country,
  ROUND((amount / NULLIF(quantity, 0))::numeric, 2) AS unit_price,
  COUNT(*) AS lineas,
  SUM(quantity) AS unidades,
  SUM(amount) AS bruto
FROM amazon_fba_sales_daily_raw
WHERE producto_id = 'a2f34a83-a941-42fd-844e-8a51286e5216'
  AND sale_date >= '2026-06-02'
  AND sale_date < '2026-07-03'
  AND raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
  AND amount IS NOT NULL
  AND quantity <> 0
GROUP BY ship_to_country, ROUND((amount / NULLIF(quantity, 0))::numeric, 2)
ORDER BY ship_to_country, unidades DESC;
