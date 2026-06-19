-- Diagnóstico ventas_diarias por producto (All Orders → ventas_diarias)
-- Ejemplo: WHERE p.sku = '8436616610104'

SELECT
  p.sku,
  vd.pais,
  vd.canal_venta,
  vd.marketplace_id,
  MIN(vd.fecha) AS desde,
  MAX(vd.fecha) AS hasta,
  SUM(vd.unidades_vendidas) AS unidades,
  SUM(vd.ingresos_brutos) AS ingresos_brutos
FROM public.ventas_diarias vd
JOIN public.productos p ON p.id = vd.producto_id
WHERE p.sku = '8436616610104'
GROUP BY p.sku, vd.pais, vd.canal_venta, vd.marketplace_id
ORDER BY hasta DESC;

-- Ventas recientes (últimos 30 días) agregadas ALL/ALL
SELECT
  p.sku,
  SUM(vd.unidades_vendidas) AS unidades_30d,
  ROUND(SUM(vd.unidades_vendidas)::numeric / 30, 2) AS media_diaria_aprox
FROM public.ventas_diarias vd
JOIN public.productos p ON p.id = vd.producto_id
WHERE p.sku = '8436616610104'
  AND vd.fecha >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY p.sku;

-- Comparar staging All Orders vs ventas_diarias (mismo SKU, últimos 90 días)
SELECT
  'staging' AS origen,
  a.marketplace_country AS pais,
  a.canal_venta,
  MIN(a.purchase_date) AS desde,
  MAX(a.purchase_date) AS hasta,
  SUM(a.quantity) AS unidades
FROM public.amazon_all_orders_items a
JOIN public.productos p ON p.id = a.producto_id
WHERE p.sku = '8436616610104'
  AND a.purchase_date >= CURRENT_DATE - INTERVAL '90 days'
  AND LOWER(a.order_status) NOT IN ('cancelled', 'canceled')
  AND LOWER(a.item_status) NOT IN ('cancelled', 'canceled')
  AND a.quantity > 0
GROUP BY a.marketplace_country, a.canal_venta

UNION ALL

SELECT
  'ventas_diarias' AS origen,
  vd.pais,
  vd.canal_venta,
  MIN(vd.fecha) AS desde,
  MAX(vd.fecha) AS hasta,
  SUM(vd.unidades_vendidas) AS unidades
FROM public.ventas_diarias vd
JOIN public.productos p ON p.id = vd.producto_id
WHERE p.sku = '8436616610104'
  AND vd.fecha >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY vd.pais, vd.canal_venta
ORDER BY origen, hasta DESC;
