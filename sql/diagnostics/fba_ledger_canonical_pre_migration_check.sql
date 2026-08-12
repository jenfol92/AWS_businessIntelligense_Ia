-- Diagnostico SELECT-only previo a la migracion canonica de Inventory Ledger.
-- No escribe datos. Ejecutar antes de 20260715_fba_ledger_daily_canonical_stock.sql.

WITH ledger AS (
  SELECT
    l.*,
    COALESCE(NULLIF(trim(to_jsonb(l)->>'report_document_id'), ''), NULLIF(trim(l.source_file_name), ''), '') AS canonical_report_document_id,
    COALESCE(NULLIF(upper(trim(to_jsonb(l)->>'condition_type')), ''), 'UNKNOWN') AS canonical_condition_type,
    upper(NULLIF(trim(l.fnsku), '')) AS canonical_fnsku,
    upper(NULLIF(trim(l.asin), '')) AS canonical_asin,
    NULLIF(trim(l.sku_limpio), '') AS informed_sku_limpio,
    COALESCE(NULLIF(upper(trim(l.disposition)), ''), 'UNKNOWN') AS canonical_disposition,
    CASE
      WHEN COALESCE(NULLIF(upper(trim(l.location)), ''), NULLIF(upper(trim(l.location_country)), ''), 'UNKNOWN') = 'UK'
        THEN 'GB'
      ELSE COALESCE(NULLIF(upper(trim(l.location)), ''), NULLIF(upper(trim(l.location_country)), ''), 'UNKNOWN')
    END AS canonical_country
  FROM public.amazon_fba_inventory_ledger_daily l
),
duplicate_groups AS (
  SELECT
    canonical_report_document_id AS report_document_id,
    canonical_fnsku AS fnsku,
    canonical_asin AS asin,
    canonical_country AS pais,
    canonical_disposition AS disposition,
    snapshot_date,
    COUNT(*) AS rows_to_merge,
    ARRAY_AGG(DISTINCT source ORDER BY source) AS sources,
    ARRAY_AGG(DISTINCT source_file_name ORDER BY source_file_name) FILTER (WHERE source_file_name IS NOT NULL AND source_file_name <> '') AS source_file_names,
    MIN(ending_warehouse_balance) AS min_ending_warehouse_balance,
    MAX(ending_warehouse_balance) AS max_ending_warehouse_balance,
    ARRAY_AGG(DISTINCT starting_warehouse_balance ORDER BY starting_warehouse_balance) AS distinct_starting_warehouse_balance,
    ARRAY_AGG(DISTINCT ending_warehouse_balance ORDER BY ending_warehouse_balance) AS distinct_ending_warehouse_balance,
    ARRAY_AGG(DISTINCT in_transit_between_warehouses ORDER BY in_transit_between_warehouses) AS distinct_in_transit_between_warehouses,
    ARRAY_AGG(DISTINCT receipts ORDER BY receipts) AS distinct_receipts,
    ARRAY_AGG(DISTINCT customer_shipments ORDER BY customer_shipments) AS distinct_customer_shipments,
    ARRAY_AGG(DISTINCT customer_returns ORDER BY customer_returns) AS distinct_customer_returns,
    ARRAY_AGG(DISTINCT vendor_returns ORDER BY vendor_returns) AS distinct_vendor_returns,
    ARRAY_AGG(DISTINCT warehouse_transfer_in_out ORDER BY warehouse_transfer_in_out) AS distinct_warehouse_transfer_in_out,
    ARRAY_AGG(DISTINCT found ORDER BY found) AS distinct_found,
    ARRAY_AGG(DISTINCT lost ORDER BY lost) AS distinct_lost,
    ARRAY_AGG(DISTINCT damaged ORDER BY damaged) AS distinct_damaged,
    ARRAY_AGG(DISTINCT disposed ORDER BY disposed) AS distinct_disposed,
    ARRAY_AGG(DISTINCT other_events ORDER BY other_events) AS distinct_other_events,
    ARRAY_AGG(DISTINCT unknown_events ORDER BY unknown_events) AS distinct_unknown_events,
    ARRAY_AGG(DISTINCT producto_id ORDER BY producto_id) FILTER (WHERE producto_id IS NOT NULL) AS distinct_product_ids,
    ARRAY_AGG(DISTINCT canonical_condition_type ORDER BY canonical_condition_type) AS distinct_condition_types,
    ARRAY_AGG(DISTINCT informed_sku_limpio ORDER BY informed_sku_limpio) FILTER (WHERE informed_sku_limpio IS NOT NULL) AS distinct_sku_limpio,
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
    )) > 1 AS quantity_conflict,
    (
      COUNT(DISTINCT COALESCE(producto_id::text, 'NULL')) > 1
      OR COUNT(DISTINCT canonical_condition_type) > 1
      OR COUNT(DISTINCT informed_sku_limpio) FILTER (WHERE informed_sku_limpio IS NOT NULL) > 1
    ) AS identity_conflict,
    NOT (
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
      )) > 1
      OR COUNT(DISTINCT COALESCE(producto_id::text, 'NULL')) > 1
      OR COUNT(DISTINCT canonical_condition_type) > 1
      OR COUNT(DISTINCT informed_sku_limpio) FILTER (WHERE informed_sku_limpio IS NOT NULL) > 1
    ) AS safe_to_merge,
    ARRAY_AGG(id ORDER BY updated_at DESC, created_at DESC, id) AS ids,
    ARRAY_AGG(DISTINCT NULLIF(trim(sku_original), '') ORDER BY NULLIF(trim(sku_original), '')) AS msku_aliases
  FROM ledger
  GROUP BY
    canonical_report_document_id,
    canonical_fnsku,
    canonical_asin,
    canonical_country,
    canonical_disposition,
    snapshot_date
  HAVING COUNT(*) > 1
)
SELECT '01_duplicate_ledger_groups_to_merge' AS section, *
FROM duplicate_groups
ORDER BY safe_to_merge ASC, quantity_conflict DESC, identity_conflict DESC, rows_to_merge DESC, snapshot_date DESC;

WITH product_asins AS (
  SELECT
    NULLIF(upper(trim(asin)), '') AS asin,
    COUNT(DISTINCT id) AS products,
    ARRAY_AGG(DISTINCT sku ORDER BY sku) AS product_skus
  FROM public.productos
  WHERE NULLIF(trim(asin), '') IS NOT NULL
  GROUP BY NULLIF(upper(trim(asin)), '')
  HAVING COUNT(DISTINCT id) > 1
)
SELECT '02_ambiguous_product_asins' AS section, *
FROM product_asins
ORDER BY products DESC, asin;

SELECT
  '03_ledger_rows_without_fnsku' AS section,
  COUNT(*) AS rows_without_fnsku,
  COUNT(*) FILTER (WHERE producto_id IS NOT NULL) AS linked_rows_without_fnsku
FROM public.amazon_fba_inventory_ledger_daily
WHERE NULLIF(trim(fnsku), '') IS NULL;

SELECT
  '04_ledger_rows_without_condition_type' AS section,
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'amazon_fba_inventory_ledger_daily'
      AND column_name = 'condition_type'
  ) AS condition_type_column_exists,
  COUNT(*) FILTER (
    WHERE NULLIF(trim(to_jsonb(l)->>'condition_type'), '') IS NULL
  ) AS rows_requiring_condition_resolution,
  COUNT(*) FILTER (
    WHERE NULLIF(trim(to_jsonb(l)->>'condition_type'), '') IS NULL
      AND upper(trim(l.disposition)) = 'SELLABLE'
  ) AS sellable_rows_requiring_condition_resolution
FROM public.amazon_fba_inventory_ledger_daily l;

WITH country_conditions AS (
  SELECT
    upper(trim(source_raw->>'fulfillment-channel-sku')) AS fnsku,
    upper(trim(source_raw->>'asin')) AS asin,
    NULLIF(upper(trim(source_raw->>'condition-type')), '') AS condition_type
  FROM public.fba_country_stock_daily c
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.raw->'sources', '[]'::jsonb)) src(source)
  CROSS JOIN LATERAL (SELECT COALESCE(src.source->'raw', '{}'::jsonb) AS source_raw) r
  WHERE NULLIF(trim(source_raw->>'condition-type'), '') IS NOT NULL
),
asin_condition_conflicts AS (
  SELECT
    asin,
    ARRAY_AGG(DISTINCT condition_type ORDER BY condition_type) AS condition_types,
    COUNT(DISTINCT condition_type) AS condition_type_count
  FROM country_conditions
  WHERE NULLIF(asin, '') IS NOT NULL
  GROUP BY asin
  HAVING COUNT(DISTINCT condition_type) > 1
)
SELECT '05_asins_that_would_be_unknown_by_condition_conflict' AS section, *
FROM asin_condition_conflicts
ORDER BY condition_type_count DESC, asin;

WITH ledger_identities AS (
  SELECT DISTINCT
    upper(trim(fnsku)) AS fnsku,
    upper(trim(asin)) AS asin
  FROM public.amazon_fba_inventory_ledger_daily
),
exact_conditions AS (
  SELECT DISTINCT
    upper(trim(source_raw->>'fulfillment-channel-sku')) AS fnsku,
    upper(trim(source_raw->>'asin')) AS asin,
    NULLIF(upper(trim(source_raw->>'condition-type')), '') AS condition_type
  FROM public.fba_country_stock_daily c
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.raw->'sources', '[]'::jsonb)) src(source)
  CROSS JOIN LATERAL (SELECT COALESCE(src.source->'raw', '{}'::jsonb) AS source_raw) r
  WHERE NULLIF(trim(source_raw->>'condition-type'), '') IS NOT NULL
),
asin_safe_conditions AS (
  SELECT
    asin,
    CASE WHEN COUNT(DISTINCT condition_type) = 1 THEN MIN(condition_type) ELSE 'UNKNOWN' END AS fallback_condition
  FROM exact_conditions
  WHERE NULLIF(asin, '') IS NOT NULL
  GROUP BY asin
)
SELECT
  '06_ledger_identities_that_would_remain_unknown' AS section,
  l.fnsku,
  l.asin,
  COALESCE(e.condition_type, a.fallback_condition, 'UNKNOWN') AS resolved_condition
FROM ledger_identities l
LEFT JOIN exact_conditions e
  ON e.fnsku = l.fnsku
 AND e.asin = l.asin
LEFT JOIN asin_safe_conditions a
  ON a.asin = l.asin
WHERE COALESCE(e.condition_type, a.fallback_condition, 'UNKNOWN') = 'UNKNOWN'
ORDER BY l.asin, l.fnsku;
