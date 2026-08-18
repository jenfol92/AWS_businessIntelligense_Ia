-- READ ONLY. Run before 20260814_02_fba_ledger_contract_consolidated.sql.
-- Baseline is the currently deployed original Ledger schema.
WITH base AS (
  SELECT l.*,
    COALESCE(NULLIF(trim(l.source_file_name), ''), '') AS legacy_document_name,
    'legacy:' || md5(COALESCE(l.source, '') || chr(31) || COALESCE(l.source_file_name, '')) AS proposed_document_identity,
    COALESCE(NULLIF(upper(trim(l.raw->>'condition-type')), ''), 'UNKNOWN') AS proposed_condition_type,
    NULLIF(upper(trim(l.location)), '') AS proposed_location_raw
  FROM public.amazon_fba_inventory_ledger_daily l
), grain AS (
  SELECT proposed_document_identity, snapshot_date, upper(trim(asin)) asin,
    upper(trim(fnsku)) fnsku, proposed_location_raw, upper(trim(disposition)) disposition,
    proposed_condition_type,
    COUNT(*) row_count,
    COUNT(DISTINCT sku_original) seller_sku_count,
    COUNT(DISTINCT COALESCE(producto_id::text, 'NULL')) product_versions,
    COUNT(DISTINCT jsonb_build_array(
      starting_warehouse_balance, ending_warehouse_balance,
      in_transit_between_warehouses, receipts, customer_shipments,
      customer_returns, vendor_returns, warehouse_transfer_in_out,
      found, lost, damaged, disposed, other_events, unknown_events
    )) quantity_versions
  FROM base
  GROUP BY proposed_document_identity, snapshot_date, upper(trim(asin)),
    upper(trim(fnsku)), proposed_location_raw, upper(trim(disposition)), proposed_condition_type
), documents AS (
  SELECT source, source_file_name, COUNT(*) rows,
    COUNT(DISTINCT snapshot_date) snapshot_days
  FROM base GROUP BY source, source_file_name
), checks AS (
  SELECT 'FNSKU_NULL_OR_EMPTY' check_name, COUNT(*)::bigint affected, true blocking
  FROM base WHERE NULLIF(trim(fnsku), '') IS NULL
  UNION ALL SELECT 'ASIN_NULL_OR_EMPTY', COUNT(*), true FROM base WHERE NULLIF(trim(asin), '') IS NULL
  UNION ALL SELECT 'LOCATION_NULL_OR_EMPTY', COUNT(*), true FROM base WHERE proposed_location_raw IS NULL
  UNION ALL SELECT 'MANUAL_DOCUMENT_WITHOUT_IDENTITY', COUNT(*), true
    FROM base WHERE source LIKE '%manual%' AND legacy_document_name = ''
  UNION ALL SELECT 'LEGACY_DOCUMENT_WITHOUT_CONTENT_HASH', COUNT(*), false
    FROM base WHERE source LIKE '%manual%'
  UNION ALL SELECT 'DUPLICATE_NEW_GRAIN_GROUPS', COUNT(*), false FROM grain WHERE row_count > 1
  UNION ALL SELECT 'QUANTITY_CONFLICT_GROUPS', COUNT(*), true FROM grain WHERE quantity_versions > 1
  UNION ALL SELECT 'PRODUCT_ID_CONFLICT_GROUPS', COUNT(*), true FROM grain WHERE product_versions > 1
  UNION ALL SELECT 'MULTIPLE_SELLER_SKU_ALIAS_GROUPS', COUNT(*), false FROM grain WHERE seller_sku_count > 1
  UNION ALL SELECT 'POTENTIALLY_COLLAPSED_ROWS', COALESCE(SUM(row_count - 1), 0), false FROM grain WHERE row_count > 1
  UNION ALL SELECT 'DOCUMENT_NAME_REUSED_ACROSS_SOURCES', COUNT(*), true
    FROM (SELECT source_file_name FROM documents WHERE source_file_name IS NOT NULL GROUP BY source_file_name HAVING COUNT(*) > 1) x
  UNION ALL SELECT 'CONDITION_UNKNOWN_ROWS', COUNT(*), false FROM base WHERE proposed_condition_type = 'UNKNOWN'
  UNION ALL SELECT 'CONDITION_CONFLICT_GRAINS', COUNT(*), true FROM (
    SELECT proposed_document_identity, snapshot_date, upper(trim(asin)), upper(trim(fnsku)),
      proposed_location_raw, upper(trim(disposition))
    FROM base GROUP BY proposed_document_identity, snapshot_date, upper(trim(asin)), upper(trim(fnsku)),
      proposed_location_raw, upper(trim(disposition))
    HAVING COUNT(DISTINCT proposed_condition_type) > 1
       AND COUNT(DISTINCT jsonb_build_array(ending_warehouse_balance, sku_original)) > 1
  ) x
)
SELECT check_name, affected, blocking,
  CASE WHEN affected = 0 THEN 'OK' WHEN blocking THEN 'BLOCK' ELSE 'REVIEW' END status
FROM checks
UNION ALL
SELECT 'SAFE_TO_MIGRATE', NULL, true,
  CASE WHEN EXISTS (SELECT 1 FROM checks WHERE blocking AND affected > 0) THEN 'NO' ELSE 'YES' END
ORDER BY check_name;
