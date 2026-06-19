-- Diagnóstico: días con/sin stock FBA por mes (corrección OWN_SALES_CORRECTED)
-- Sustituir <PRODUCT_ID> por el UUID del producto.

SELECT
  sku_limpio,
  date_trunc('month', snapshot_date)::date AS mes,
  count(*) FILTER (WHERE stock_sellable > 0) AS dias_con_stock,
  count(*) FILTER (WHERE stock_sellable <= 0) AS dias_sin_stock,
  max(stock_sellable) AS max_stock,
  avg(stock_sellable) AS avg_stock
FROM public.v_product_fba_stock_daily
WHERE producto_id = '<PRODUCT_ID>'
GROUP BY sku_limpio, date_trunc('month', snapshot_date)
ORDER BY mes;

-- Ventas mensuales históricas del mismo producto
SELECT
  date_trunc('month', fecha)::date AS mes,
  sum(unidades_vendidas) AS ventas
FROM public.ventas_diarias
WHERE producto_id = '<PRODUCT_ID>'
GROUP BY date_trunc('month', fecha)
ORDER BY mes;
