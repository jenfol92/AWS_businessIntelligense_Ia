-- Fuente canónica de stock FBA por producto y país/ubicación.
-- No escribe datos: consolida el último Inventory Ledger disponible.

CREATE OR REPLACE VIEW public.v_latest_fba_inventory_by_product_country AS
WITH latest_day AS (
  SELECT
    producto_id,
    MAX(snapshot_date) AS snapshot_date
  FROM public.amazon_fba_inventory_ledger_daily
  WHERE producto_id IS NOT NULL
  GROUP BY producto_id
),
base AS (
  SELECT
    l.producto_id,
    COALESCE(
      NULLIF(trim(l.location), ''),
      NULLIF(trim(l.location_country), ''),
      'UNKNOWN'
    ) AS pais,
    l.snapshot_date,
    COALESCE(NULLIF(upper(trim(l.disposition)), ''), 'UNKNOWN') AS disposition,
    COALESCE(l.ending_warehouse_balance, 0) AS ending_warehouse_balance,
    l.updated_at
  FROM public.amazon_fba_inventory_ledger_daily l
  INNER JOIN latest_day d
    ON d.producto_id = l.producto_id
   AND d.snapshot_date = l.snapshot_date
),
disposition_totals AS (
  SELECT
    producto_id,
    pais,
    snapshot_date,
    disposition,
    MAX(updated_at) AS last_imported_at,
    SUM(ending_warehouse_balance)::bigint AS stock
  FROM base
  GROUP BY producto_id, pais, snapshot_date, disposition
)
SELECT
  producto_id,
  pais,
  snapshot_date,
  MAX(last_imported_at) AS last_imported_at,
  COALESCE(
    SUM(stock) FILTER (WHERE disposition = 'SELLABLE'),
    0
  )::bigint AS stock_fba_sellable,
  COALESCE(
    SUM(stock) FILTER (WHERE disposition <> 'SELLABLE'),
    0
  )::bigint AS stock_fba_unsellable,
  COALESCE(SUM(stock), 0)::bigint AS stock_fba_physical_total,
  jsonb_agg(
    jsonb_build_object(
      'disposition', disposition,
      'stock', stock
    )
    ORDER BY
      CASE WHEN disposition = 'SELLABLE' THEN 0 ELSE 1 END,
      stock DESC,
      disposition
  ) AS dispositions,
  ((CURRENT_DATE - snapshot_date) > 3) AS is_stale,
  GREATEST((CURRENT_DATE - snapshot_date), 0)::integer AS stale_days
FROM disposition_totals
GROUP BY producto_id, pais, snapshot_date;

COMMENT ON VIEW public.v_latest_fba_inventory_by_product_country IS
  'Fuente canónica de stock FBA por producto y ubicación/país desde el último Inventory Ledger. SELLABLE es stock operativo; no apto queda separado.';

GRANT SELECT ON public.v_latest_fba_inventory_by_product_country TO anon;
GRANT SELECT ON public.v_latest_fba_inventory_by_product_country TO authenticated;
GRANT SELECT ON public.v_latest_fba_inventory_by_product_country TO service_role;
