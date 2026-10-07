-- Diagnóstico SOLO LECTURA: stock por país de un producto según cada fuente.
-- Uso: cambia el SKU en params y ejecuta en el SQL editor de Supabase.
-- Compara:
--   ledger   = v_latest_fba_inventory_by_product_country (lo que pinta hoy "Stock físico por país")
--   afn      = fba_country_stock_daily (informe GET_AFN_INVENTORY_DATA_BY_COUNTRY), último snapshot
--   legacy   = inventario_paises (stock_fba / stock_fbm)
--   fbm      = v_latest_amazon_fbm_inventory_by_product (FBM canónico por marketplace)

WITH params AS (
  SELECT id AS producto_id, sku FROM public.productos WHERE sku = 'CAMBIA-ESTE-SKU'
),
ledger AS (
  SELECT v.pais, v.snapshot_date AS ledger_date, v.stock_fba_sellable AS ledger_sellable,
         v.stock_fba_unsellable AS ledger_unsellable, v.is_stale AS ledger_stale
  FROM public.v_latest_fba_inventory_by_product_country v
  JOIN params p ON p.producto_id = v.producto_id
),
afn_latest AS (
  SELECT f.marketplace_country AS pais, f.snapshot_date AS afn_date, SUM(f.stock_fba) AS afn_stock
  FROM public.fba_country_stock_daily f
  JOIN params p ON p.producto_id = f.producto_id
  WHERE f.snapshot_date = (
    SELECT MAX(snapshot_date) FROM public.fba_country_stock_daily x WHERE x.producto_id = f.producto_id
  )
  GROUP BY f.marketplace_country, f.snapshot_date
),
legacy AS (
  SELECT i.pais, i.stock_fba AS legacy_fba, i.stock_fbm AS legacy_fbm, i.updated_at AS legacy_updated_at
  FROM public.inventario_paises i
  JOIN params p ON p.producto_id = i.producto_id
),
fbm AS (
  SELECT m.marketplace_id, m.stock_fbm AS fbm_canonical, m.observed_at AS fbm_observed_at
  FROM public.v_latest_amazon_fbm_inventory_by_product m
  JOIN params p ON p.producto_id = m.producto_id
),
countries AS (
  SELECT pais FROM ledger UNION SELECT pais FROM afn_latest UNION SELECT pais FROM legacy
)
SELECT c.pais,
       l.ledger_sellable, l.ledger_unsellable, l.ledger_date, l.ledger_stale,
       a.afn_stock, a.afn_date,
       g.legacy_fba, g.legacy_fbm, g.legacy_updated_at
FROM countries c
LEFT JOIN ledger l ON l.pais = c.pais
LEFT JOIN afn_latest a ON a.pais = c.pais
LEFT JOIN legacy g ON g.pais = c.pais
ORDER BY c.pais;

-- FBM canónico por marketplace (lo que usa el panel de stock operativo):
-- SELECT m.* FROM public.v_latest_amazon_fbm_inventory_by_product m
-- JOIN public.productos p ON p.id = m.producto_id WHERE p.sku = 'CAMBIA-ESTE-SKU';

-- Fechas de los ledgers importados (¿se está actualizando el Inventory Ledger?):
-- SELECT snapshot_date, count(*) FROM public.amazon_fba_inventory_ledger_daily
-- GROUP BY snapshot_date ORDER BY snapshot_date DESC LIMIT 10;
