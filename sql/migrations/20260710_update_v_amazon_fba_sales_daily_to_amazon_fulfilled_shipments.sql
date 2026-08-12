CREATE OR REPLACE VIEW public.v_amazon_fba_sales_daily AS
SELECT
  producto_id,
  sale_date AS fecha,
  COALESCE(NULLIF(ship_to_country, ''), 'UNKNOWN') AS pais,
  'FBA'::text AS canal_venta,
  COALESCE(NULLIF(currency, ''), 'EUR') AS moneda,
  marketplace_id,
  SUM(COALESCE(quantity, 0))::integer AS unidades_vendidas,
  SUM(COALESCE(amount, 0))::numeric AS ingresos_brutos
FROM public.amazon_fba_sales_daily_raw
WHERE producto_id IS NOT NULL
  AND raw->>'report_type' = 'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'
GROUP BY
  producto_id,
  sale_date,
  COALESCE(NULLIF(ship_to_country, ''), 'UNKNOWN'),
  COALESCE(NULLIF(currency, ''), 'EUR'),
  marketplace_id;

COMMENT ON VIEW public.v_amazon_fba_sales_daily IS
  'Vista operativa de ventas FBA SP-API. Usa solo GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL.';
