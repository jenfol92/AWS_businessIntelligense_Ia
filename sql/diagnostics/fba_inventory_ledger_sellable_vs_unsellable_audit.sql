-- Auditoria SELECT-only: FBA Inventory Ledger vendible vs no apto vs panel.
-- Caso: producto_id 614e8e63-b23a-4c4f-8915-abf19a86702f
-- ASIN/SKU visibles: B0DJBQGKBT / 8436616610104

-- A) Columnas reales de amazon_fba_inventory_ledger_daily.
SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'amazon_fba_inventory_ledger_daily'
ORDER BY ordinal_position;

-- B) Ultimas filas ledger para el producto.
SELECT *
FROM public.amazon_fba_inventory_ledger_daily
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
ORDER BY snapshot_date DESC, updated_at DESC, created_at DESC
LIMIT 200;

-- C) Ultimo snapshot agrupado por disposition/location/SKU/FNSKU.
WITH last_day AS (
  SELECT MAX(snapshot_date) AS snapshot_date
  FROM public.amazon_fba_inventory_ledger_daily
  WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
)
SELECT
  l.snapshot_date,
  l.disposition,
  l.location,
  l.location_country,
  l.sku_original,
  l.sku_limpio,
  l.fnsku,
  l.asin,
  SUM(l.ending_warehouse_balance) AS saldo_final
FROM public.amazon_fba_inventory_ledger_daily l
JOIN last_day d ON d.snapshot_date = l.snapshot_date
WHERE l.producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
GROUP BY
  l.snapshot_date,
  l.disposition,
  l.location,
  l.location_country,
  l.sku_original,
  l.sku_limpio,
  l.fnsku,
  l.asin
ORDER BY l.location, l.disposition, l.sku_original, l.fnsku;

-- D) Stock SELLABLE esperado por ubicacion fisica.
-- Esperado segun captura Amazon 2026-07-13:
-- GB = 395, DE = 358.
WITH last_day AS (
  SELECT MAX(snapshot_date) AS snapshot_date
  FROM public.amazon_fba_inventory_ledger_daily
  WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
)
SELECT
  COALESCE(NULLIF(trim(l.location), ''), NULLIF(trim(l.location_country), ''), 'UNKNOWN') AS pais,
  SUM(l.ending_warehouse_balance) AS fba_vendible
FROM public.amazon_fba_inventory_ledger_daily l
JOIN last_day d ON d.snapshot_date = l.snapshot_date
WHERE l.producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND upper(trim(l.disposition)) = 'SELLABLE'
GROUP BY 1
ORDER BY pais;

-- E) Stock NO APTO por ubicacion/disposition.
-- Esperado segun captura Amazon 2026-07-13:
-- ES WAREHOUSE_DAMAGED 1; ES CUSTOMER_DAMAGED 2; GB DEFECTIVE 1;
-- GB CUSTOMER_DAMAGED 1; IT DEFECTIVE 2; IT CUSTOMER_DAMAGED 1;
-- PL CUSTOMER_DAMAGED 1.
WITH last_day AS (
  SELECT MAX(snapshot_date) AS snapshot_date
  FROM public.amazon_fba_inventory_ledger_daily
  WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
)
SELECT
  COALESCE(NULLIF(trim(l.location), ''), NULLIF(trim(l.location_country), ''), 'UNKNOWN') AS pais,
  l.disposition,
  SUM(l.ending_warehouse_balance) AS fba_no_apto
FROM public.amazon_fba_inventory_ledger_daily l
JOIN last_day d ON d.snapshot_date = l.snapshot_date
WHERE l.producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND upper(trim(l.disposition)) <> 'SELLABLE'
GROUP BY 1, l.disposition
ORDER BY pais, l.disposition;

-- F) Comparar inventario_paises contra ledger SELLABLE.
WITH inv AS (
  SELECT
    pais,
    SUM(stock_fba) AS stock_panel
  FROM public.inventario_paises
  WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  GROUP BY pais
),
last_day AS (
  SELECT MAX(snapshot_date) AS snapshot_date
  FROM public.amazon_fba_inventory_ledger_daily
  WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
),
ledger_sellable AS (
  SELECT
    COALESCE(NULLIF(trim(l.location), ''), NULLIF(trim(l.location_country), ''), 'UNKNOWN') AS pais,
    SUM(l.ending_warehouse_balance) AS stock_sellable
  FROM public.amazon_fba_inventory_ledger_daily l
  JOIN last_day d ON d.snapshot_date = l.snapshot_date
  WHERE l.producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
    AND upper(trim(l.disposition)) = 'SELLABLE'
  GROUP BY 1
)
SELECT
  COALESCE(inv.pais, ledger_sellable.pais) AS pais,
  COALESCE(inv.stock_panel, 0) AS stock_panel,
  COALESCE(ledger_sellable.stock_sellable, 0) AS stock_sellable_ledger,
  COALESCE(inv.stock_panel, 0) - COALESCE(ledger_sellable.stock_sellable, 0) AS diff
FROM inv
FULL JOIN ledger_sellable ON ledger_sellable.pais = inv.pais
ORDER BY ABS(COALESCE(inv.stock_panel, 0) - COALESCE(ledger_sellable.stock_sellable, 0)) DESC;

-- G) Detectar origen de FR.
SELECT *
FROM public.inventario_paises
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND pais = 'FR';

SELECT *
FROM public.amazon_fba_inventory_ledger_daily
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  AND (
    location = 'FR'
    OR location_country = 'FR'
    OR sku_original ILIKE '%FR%'
    OR sku_limpio ILIKE '%FR%'
    OR disposition ILIKE '%FR%'
    OR asin ILIKE '%B0DJBQGKBT%'
    OR sku_original ILIKE '%8436616610104%'
    OR sku_limpio ILIKE '%8436616610104%'
  )
ORDER BY snapshot_date DESC, updated_at DESC, created_at DESC
LIMIT 100;

-- H) Vista consolidada actual usada por el RPC de stock ledger total.
SELECT *
FROM public.v_product_fba_stock_daily
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
ORDER BY snapshot_date DESC, sku_limpio
LIMIT 100;
