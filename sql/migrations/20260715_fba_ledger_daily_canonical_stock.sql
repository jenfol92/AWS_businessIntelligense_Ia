-- Canonical FBA stock from Inventory Ledger Summary.
-- Grain: one physical inventory bag per report/date/FNSKU/ASIN/location/disposition.
-- MSKU aliases are metadata and must not multiply EndingWarehouseBalance.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE public.amazon_fba_inventory_ledger_daily
  ADD COLUMN IF NOT EXISTS msku_aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS condition_type text NULL,
  ADD COLUMN IF NOT EXISTS report_document_id text NOT NULL DEFAULT '';

UPDATE public.amazon_fba_inventory_ledger_daily
SET
  msku_aliases = CASE
    WHEN cardinality(msku_aliases) = 0 AND NULLIF(trim(sku_original), '') IS NOT NULL
      THEN ARRAY[trim(sku_original)]
    ELSE msku_aliases
  END,
  report_document_id = COALESCE(NULLIF(trim(report_document_id), ''), NULLIF(trim(source_file_name), ''), ''),
  fnsku = COALESCE(NULLIF(upper(trim(fnsku)), ''), ''),
  asin = COALESCE(NULLIF(upper(trim(asin)), ''), ''),
  disposition = COALESCE(NULLIF(upper(trim(disposition)), ''), 'UNKNOWN'),
  location = CASE
    WHEN COALESCE(NULLIF(upper(trim(location)), ''), NULLIF(upper(trim(location_country)), ''), 'UNKNOWN') = 'UK'
      THEN 'GB'
    ELSE COALESCE(NULLIF(upper(trim(location)), ''), NULLIF(upper(trim(location_country)), ''), 'UNKNOWN')
  END,
  location_country = CASE
    WHEN COALESCE(NULLIF(upper(trim(location)), ''), NULLIF(upper(trim(location_country)), ''), 'UNKNOWN') = 'UK'
      THEN 'GB'
    ELSE COALESCE(NULLIF(upper(trim(location)), ''), NULLIF(upper(trim(location_country)), ''), 'UNKNOWN')
  END,
  condition_type = NULLIF(upper(trim(condition_type)), '')
WHERE true;

WITH latest_country_condition AS (
  SELECT DISTINCT ON (
    upper(trim(source_raw->>'fulfillment-channel-sku')),
    upper(trim(source_raw->>'asin'))
  )
    upper(trim(source_raw->>'fulfillment-channel-sku')) AS fnsku,
    upper(trim(source_raw->>'asin')) AS asin,
    NULLIF(upper(trim(source_raw->>'condition-type')), '') AS condition_type
  FROM public.fba_country_stock_daily c
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.raw->'sources', '[]'::jsonb)) src(source)
  CROSS JOIN LATERAL (SELECT COALESCE(src.source->'raw', '{}'::jsonb) AS source_raw) r
  WHERE NULLIF(trim(source_raw->>'condition-type'), '') IS NOT NULL
  ORDER BY
    upper(trim(source_raw->>'fulfillment-channel-sku')),
    upper(trim(source_raw->>'asin')),
    c.snapshot_date DESC,
    c.created_at DESC
)
UPDATE public.amazon_fba_inventory_ledger_daily l
SET condition_type = cc.condition_type
FROM latest_country_condition cc
WHERE l.condition_type IS NULL
  AND l.fnsku = cc.fnsku
  AND l.asin = cc.asin;

DO $$
DECLARE
  conflict_groups integer;
BEGIN
  WITH duplicate_groups AS (
    SELECT
      report_document_id,
      fnsku,
      asin,
      snapshot_date,
      disposition,
      location,
      COUNT(DISTINCT (
        COALESCE(starting_warehouse_balance, 0),
        COALESCE(ending_warehouse_balance, 0),
        COALESCE(in_transit_between_warehouses, 0),
        COALESCE(receipts, 0),
        COALESCE(customer_shipments, 0),
        COALESCE(customer_returns, 0),
        COALESCE(vendor_returns, 0),
        COALESCE(warehouse_transfer_in_out, 0),
        COALESCE(found, 0),
        COALESCE(lost, 0),
        COALESCE(damaged, 0),
        COALESCE(disposed, 0),
        COALESCE(other_events, 0),
        COALESCE(unknown_events, 0)
      )) AS quantity_versions,
      COUNT(DISTINCT COALESCE(producto_id::text, 'NULL')) AS product_versions,
      COUNT(DISTINCT COALESCE(NULLIF(upper(trim(condition_type)), ''), 'UNKNOWN')) AS condition_versions,
      COUNT(DISTINCT NULLIF(trim(sku_limpio), '')) FILTER (
        WHERE NULLIF(trim(sku_limpio), '') IS NOT NULL
      ) AS informed_sku_versions
    FROM public.amazon_fba_inventory_ledger_daily
    GROUP BY
      report_document_id,
      fnsku,
      asin,
      snapshot_date,
      disposition,
      location
    HAVING COUNT(*) > 1
  )
  SELECT COUNT(*) INTO conflict_groups
  FROM duplicate_groups
  WHERE quantity_versions > 1
     OR product_versions > 1
     OR condition_versions > 1
     OR informed_sku_versions > 1;

  IF conflict_groups > 0 THEN
    RAISE EXCEPTION
      'FBA ledger canonical migration aborted: % duplicate groups are not safe to merge.',
      conflict_groups;
  END IF;
END $$;

WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY report_document_id, fnsku, asin, snapshot_date, disposition, location
      ORDER BY updated_at DESC, created_at DESC, id
    ) AS keep_id
  FROM public.amazon_fba_inventory_ledger_daily
),
merged AS (
  SELECT
    keep_id,
    array_agg(DISTINCT alias ORDER BY alias) FILTER (WHERE alias IS NOT NULL AND alias <> '') AS aliases
  FROM ranked r
  JOIN public.amazon_fba_inventory_ledger_daily l ON l.id = r.id
  LEFT JOIN LATERAL unnest(
    CASE
      WHEN cardinality(l.msku_aliases) > 0 THEN l.msku_aliases
      ELSE ARRAY[l.sku_original]
    END
  ) alias ON true
  GROUP BY keep_id
)
UPDATE public.amazon_fba_inventory_ledger_daily l
SET msku_aliases = COALESCE(m.aliases, l.msku_aliases)
FROM merged m
WHERE l.id = m.keep_id;

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY report_document_id, fnsku, asin, snapshot_date, disposition, location
      ORDER BY updated_at DESC, created_at DESC, id
    ) AS rn
  FROM public.amazon_fba_inventory_ledger_daily
)
DELETE FROM public.amazon_fba_inventory_ledger_daily l
USING ranked r
WHERE l.id = r.id
  AND r.rn > 1;

ALTER TABLE public.amazon_fba_inventory_ledger_daily
  DROP CONSTRAINT IF EXISTS amazon_fba_inventory_ledger_daily_unique;

ALTER TABLE public.amazon_fba_inventory_ledger_daily
  ADD CONSTRAINT amazon_fba_inventory_ledger_daily_unique
  UNIQUE (
    report_document_id,
    fnsku,
    asin,
    snapshot_date,
    disposition,
    location
  );

CREATE INDEX IF NOT EXISTS idx_amz_fba_ledger_condition
  ON public.amazon_fba_inventory_ledger_daily (condition_type)
  WHERE condition_type IS NOT NULL;

COMMENT ON CONSTRAINT amazon_fba_inventory_ledger_daily_unique
  ON public.amazon_fba_inventory_ledger_daily IS
  'Physical Ledger bag grain: report_document_id/FNSKU/ASIN/date/disposition/location. Source is metadata and does not multiply EndingWarehouseBalance.';

COMMENT ON COLUMN public.amazon_fba_inventory_ledger_daily.msku_aliases IS
  'All MSKU/Seller SKU aliases shown by Amazon for the same physical Ledger row.';

COMMENT ON COLUMN public.amazon_fba_inventory_ledger_daily.condition_type IS
  'Auxiliary condition-type, preferably resolved from GET_AFN_INVENTORY_DATA_BY_COUNTRY metadata. Quantity still comes from Ledger.';

COMMENT ON COLUMN public.amazon_fba_inventory_ledger_daily.report_document_id IS
  'Amazon report document id. Manual files without Amazon document id use manual:<sha256(content)> for idempotent Ledger imports.';

CREATE OR REPLACE VIEW public.v_product_fba_stock_daily AS
WITH canonical AS (
  SELECT DISTINCT ON (
    l.producto_id,
    l.sku_limpio,
    l.snapshot_date,
    l.fnsku,
    l.asin,
    l.location,
    l.disposition
  )
    l.producto_id,
    l.sku_limpio,
    l.snapshot_date,
    l.disposition,
    COALESCE(NULLIF(upper(trim(l.condition_type)), ''), 'UNKNOWN') AS condition_type,
    COALESCE(l.ending_warehouse_balance, 0) AS ending_warehouse_balance,
    COALESCE(l.receipts, 0) AS receipts,
    COALESCE(l.customer_shipments, 0) AS customer_shipments,
    COALESCE(l.customer_returns, 0) AS customer_returns,
    COALESCE(l.in_transit_between_warehouses, 0) AS in_transit_between_warehouses,
    l.location
  FROM public.amazon_fba_inventory_ledger_daily l
  WHERE l.producto_id IS NOT NULL
  ORDER BY
    l.producto_id,
    l.sku_limpio,
    l.snapshot_date,
    l.fnsku,
    l.asin,
    l.location,
    l.disposition,
    l.updated_at DESC
)
SELECT
  c.producto_id,
  c.sku_limpio,
  c.snapshot_date,
  SUM(
    CASE
      WHEN c.disposition = 'SELLABLE' AND c.condition_type = 'NEWITEM'
        THEN c.ending_warehouse_balance
      ELSE 0
    END
  )::bigint AS stock_sellable,
  SUM(
    CASE
      WHEN c.disposition <> 'SELLABLE'
        THEN c.ending_warehouse_balance
      ELSE 0
    END
  )::bigint AS stock_unsellable,
  SUM(c.ending_warehouse_balance)::bigint AS stock_total,
  SUM(c.receipts)::bigint AS receipts,
  SUM(c.customer_shipments)::bigint AS customer_shipments,
  SUM(c.customer_returns)::bigint AS customer_returns,
  SUM(c.in_transit_between_warehouses)::bigint AS in_transit_between_warehouses,
  COUNT(DISTINCT NULLIF(trim(c.location), ''))::integer AS locations_count
FROM canonical c
GROUP BY
  c.producto_id,
  c.sku_limpio,
  c.snapshot_date;

CREATE OR REPLACE VIEW public.v_latest_fba_inventory_by_product_country AS
WITH latest_day AS (
  SELECT
    producto_id,
    MAX(snapshot_date) AS snapshot_date
  FROM public.amazon_fba_inventory_ledger_daily
  WHERE producto_id IS NOT NULL
  GROUP BY producto_id
),
canonical AS (
  SELECT DISTINCT ON (
    l.producto_id,
    l.snapshot_date,
    l.fnsku,
    l.asin,
    l.location,
    l.disposition
  )
    l.producto_id,
    l.location AS pais,
    l.snapshot_date,
    l.disposition,
    COALESCE(NULLIF(upper(trim(l.condition_type)), ''), 'UNKNOWN') AS condition_type,
    COALESCE(l.ending_warehouse_balance, 0) AS ending_warehouse_balance,
    l.updated_at,
    l.fnsku,
    l.asin,
    l.msku_aliases
  FROM public.amazon_fba_inventory_ledger_daily l
  INNER JOIN latest_day d
    ON d.producto_id = l.producto_id
   AND d.snapshot_date = l.snapshot_date
  ORDER BY
    l.producto_id,
    l.snapshot_date,
    l.fnsku,
    l.asin,
    l.location,
    l.disposition,
    l.updated_at DESC
),
country_totals AS (
  SELECT
    producto_id,
    pais,
    snapshot_date,
    MAX(updated_at) AS last_imported_at,
    SUM(ending_warehouse_balance) FILTER (
      WHERE disposition = 'SELLABLE' AND condition_type = 'NEWITEM'
    )::bigint AS stock_new_sellable,
    SUM(ending_warehouse_balance) FILTER (
      WHERE disposition = 'SELLABLE' AND condition_type NOT IN ('NEWITEM', 'UNKNOWN')
    )::bigint AS stock_used_sellable,
    SUM(ending_warehouse_balance) FILTER (
      WHERE disposition = 'SELLABLE' AND condition_type = 'UNKNOWN'
    )::bigint AS stock_unknown_sellable,
    SUM(ending_warehouse_balance) FILTER (
      WHERE disposition <> 'SELLABLE'
    )::bigint AS stock_unsellable,
    SUM(ending_warehouse_balance)::bigint AS stock_physical_total,
    jsonb_agg(
      jsonb_build_object(
        'fnsku', fnsku,
        'asin', asin,
        'conditionType', condition_type,
        'disposition', disposition,
        'stock', ending_warehouse_balance,
        'mskuAliases', msku_aliases
      )
      ORDER BY disposition, condition_type, fnsku, asin
    ) AS dispositions
  FROM canonical
  GROUP BY producto_id, pais, snapshot_date
)
SELECT
  producto_id,
  pais,
  snapshot_date,
  last_imported_at,
  COALESCE(stock_new_sellable, 0)::bigint AS stock_fba_sellable,
  COALESCE(stock_unsellable, 0)::bigint AS stock_fba_unsellable,
  COALESCE(stock_physical_total, 0)::bigint AS stock_fba_physical_total,
  COALESCE(stock_new_sellable, 0)::bigint AS stock_new_sellable,
  COALESCE(stock_used_sellable, 0)::bigint AS stock_used_sellable,
  COALESCE(stock_unknown_sellable, 0)::bigint AS stock_unknown_sellable,
  COALESCE(stock_unsellable, 0)::bigint AS stock_unsellable,
  dispositions,
  ((CURRENT_DATE - snapshot_date) > 3) AS is_stale,
  GREATEST((CURRENT_DATE - snapshot_date), 0)::integer AS stale_days
FROM country_totals;

CREATE OR REPLACE FUNCTION public.get_latest_fba_ledger_stock_by_products(product_ids uuid[])
RETURNS TABLE (
  producto_id uuid,
  snapshot_date date,
  stock_sellable integer,
  stock_total integer
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    v.producto_id,
    v.snapshot_date,
    COALESCE(SUM(v.stock_fba_sellable), 0)::integer AS stock_sellable,
    COALESCE(SUM(v.stock_fba_physical_total), 0)::integer AS stock_total
  FROM public.v_latest_fba_inventory_by_product_country v
  WHERE v.producto_id = ANY(product_ids)
  GROUP BY v.producto_id, v.snapshot_date;
$$;

COMMENT ON VIEW public.v_latest_fba_inventory_by_product_country IS
  'Canonical current FBA stock by product/country from latest daily Inventory Ledger. Principal FBA is NewItem + SELLABLE EndingWarehouseBalance; used/unknown/unsellable stay separate.';

COMMENT ON VIEW public.v_product_fba_stock_daily IS
  'Daily FBA stock from Inventory Ledger. stock_sellable means NewItem + SELLABLE, deduped by FNSKU/ASIN/location/disposition.';

GRANT SELECT ON public.v_latest_fba_inventory_by_product_country TO anon;
GRANT SELECT ON public.v_latest_fba_inventory_by_product_country TO authenticated;
GRANT SELECT ON public.v_latest_fba_inventory_by_product_country TO service_role;

GRANT EXECUTE ON FUNCTION public.get_latest_fba_ledger_stock_by_products(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.get_latest_fba_ledger_stock_by_products(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_latest_fba_ledger_stock_by_products(uuid[]) TO service_role;

COMMIT;
