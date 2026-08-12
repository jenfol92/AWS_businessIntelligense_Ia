-- Diagnostico SELECT-only: fuente canonica FBA Inventory Ledger vs legacy.
-- Producto auditado:
-- 614e8e63-b23a-4c4f-8915-abf19a86702f

-- 1) Ultimo snapshot disponible en ledger.
WITH latest_snapshot AS (
  SELECT
    producto_id,
    MAX(snapshot_date) AS latest_snapshot_date
  FROM public.amazon_fba_inventory_ledger_daily
  WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  GROUP BY producto_id
),
latest_rows AS (
  SELECT
    l.producto_id,
    l.snapshot_date,
    l.updated_at,
    COALESCE(NULLIF(upper(trim(l.disposition)), ''), 'UNKNOWN') AS disposition,
    COALESCE(NULLIF(upper(trim(l.condition_type)), ''), 'UNKNOWN') AS condition_type,
    COALESCE(l.ending_warehouse_balance, 0) AS ending_warehouse_balance
  FROM public.amazon_fba_inventory_ledger_daily l
  INNER JOIN latest_snapshot s
    ON s.producto_id = l.producto_id
   AND s.latest_snapshot_date = l.snapshot_date
)
SELECT
  producto_id,
  snapshot_date AS latest_snapshot_date,
  MAX(updated_at) AS latest_imported_at,
  COUNT(*) AS ledger_rows,
  COALESCE(SUM(ending_warehouse_balance) FILTER (
    WHERE disposition = 'SELLABLE' AND condition_type = 'NEWITEM'
  ), 0) AS stock_fba_new_sellable,
  COALESCE(SUM(ending_warehouse_balance) FILTER (
    WHERE disposition = 'SELLABLE' AND condition_type NOT IN ('NEWITEM', 'UNKNOWN')
  ), 0) AS stock_fba_used_sellable,
  COALESCE(SUM(ending_warehouse_balance) FILTER (
    WHERE disposition = 'SELLABLE' AND condition_type = 'UNKNOWN'
  ), 0) AS stock_fba_unknown_sellable,
  COALESCE(SUM(ending_warehouse_balance) FILTER (
    WHERE disposition <> 'SELLABLE'
  ), 0) AS stock_fba_unsellable,
  COALESCE(SUM(ending_warehouse_balance), 0) AS stock_fba_physical_total
FROM latest_rows
GROUP BY producto_id, snapshot_date;

-- 2) Stock FBA por pais desde la vista canonica.
SELECT
  producto_id,
  pais,
  snapshot_date,
  last_imported_at,
  stock_fba_sellable,
  stock_fba_unsellable,
  stock_fba_physical_total,
  dispositions,
  is_stale,
  stale_days
FROM public.v_latest_fba_inventory_by_product_country
WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
ORDER BY pais;

-- 3/4) Comparativa con inventario_paises solo como auditoria legacy.
WITH canonical AS (
  SELECT
    pais,
    stock_fba_sellable,
    stock_fba_unsellable,
    stock_fba_physical_total,
    snapshot_date,
    last_imported_at
  FROM public.v_latest_fba_inventory_by_product_country
  WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
),
legacy AS (
  SELECT
    pais,
    SUM(stock_fba) AS stock_fba_legacy,
    SUM(stock_fbm) AS stock_fbm_legacy,
    MAX(updated_at) AS legacy_updated_at
  FROM public.inventario_paises
  WHERE producto_id = '614e8e63-b23a-4c4f-8915-abf19a86702f'
  GROUP BY pais
)
SELECT
  COALESCE(canonical.pais, legacy.pais) AS pais,
  COALESCE(canonical.stock_fba_sellable, 0) AS stock_fba_canonical_sellable,
  COALESCE(canonical.stock_fba_unsellable, 0) AS stock_fba_canonical_unsellable,
  COALESCE(canonical.stock_fba_physical_total, 0) AS stock_fba_canonical_physical,
  COALESCE(legacy.stock_fba_legacy, 0) AS stock_fba_legacy,
  COALESCE(legacy.stock_fbm_legacy, 0) AS stock_fbm_legacy,
  COALESCE(legacy.stock_fba_legacy, 0)
    - COALESCE(canonical.stock_fba_sellable, 0) AS diff_legacy_vs_canonical_sellable,
  canonical.snapshot_date,
  canonical.last_imported_at,
  legacy.legacy_updated_at
FROM canonical
FULL JOIN legacy ON legacy.pais = canonical.pais
ORDER BY ABS(
  COALESCE(legacy.stock_fba_legacy, 0)
    - COALESCE(canonical.stock_fba_sellable, 0)
) DESC, pais;
