-- Validación stock FBA por país en inventario_paises (post-import AFN by country)
-- Ejemplo: SKU ALAIA

SELECT
  p.sku,
  i.pais,
  i.marketplace_id,
  i.stock_fba,
  i.stock_fbm,
  COALESCE(i.stock_fba, 0) + COALESCE(i.stock_fbm, 0) AS stock_total_pais,
  i.updated_at
FROM public.inventario_paises i
JOIN public.productos p ON p.id = i.producto_id
WHERE p.sku = '8436616610104'
ORDER BY i.pais;

-- Último snapshot histórico por país (si existe fba_country_stock_daily)
SELECT
  p.sku,
  h.marketplace_country,
  h.marketplace_id,
  h.snapshot_date,
  h.stock_fba,
  h.source
FROM public.fba_country_stock_daily h
JOIN public.productos p ON p.id = h.producto_id
WHERE p.sku = '8436616610104'
ORDER BY h.snapshot_date DESC, h.marketplace_country;
