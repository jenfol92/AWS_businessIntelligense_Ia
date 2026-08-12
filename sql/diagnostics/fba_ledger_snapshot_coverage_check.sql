-- Cobertura temporal del Inventory Ledger FBA para un producto.
-- SELECT-only. Producto auditado:
-- 614e8e63-b23a-4c4f-8915-abf19a86702f

SELECT
  producto_id,
  MAX(snapshot_date) AS latest_snapshot_date,
  COUNT(*) AS rows,
  SUM(
    CASE
      WHEN upper(trim(disposition)) = 'SELLABLE'
      THEN ending_warehouse_balance
      ELSE 0
    END
  ) AS sellable
FROM public.amazon_fba_inventory_ledger_daily
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
GROUP BY producto_id;

SELECT
  snapshot_date,
  location,
  disposition,
  sku_original,
  sku_limpio,
  fnsku,
  asin,
  SUM(ending_warehouse_balance) AS stock
FROM public.amazon_fba_inventory_ledger_daily
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
GROUP BY
  snapshot_date,
  location,
  disposition,
  sku_original,
  sku_limpio,
  fnsku,
  asin
ORDER BY snapshot_date DESC, location, disposition;
