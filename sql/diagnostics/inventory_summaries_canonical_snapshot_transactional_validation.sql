-- Ejecutar solo despues de aplicar el cuerpo de la migracion dentro de la misma
-- transaccion externa. El caller es responsable de hacer ROLLBACK.

SELECT 'SCHEMA_OBJECTS' AS check_name,
       to_regclass('public.amazon_fba_inventory_snapshot_runs') IS NOT NULL AS runs_table,
       to_regprocedure('public.commit_amazon_fba_inventory_snapshot_run(uuid,timestamp with time zone,text[],integer,jsonb)') IS NOT NULL AS commit_rpc,
       to_regclass('public.v_latest_amazon_fba_inventory_by_product_pool') IS NOT NULL AS pool_view;

SELECT 'REQUIRED_COLUMNS' AS check_name, count(*) AS found_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'amazon_fba_inventory_snapshots'
  AND column_name = ANY (ARRAY[
    'snapshot_run_id', 'observed_at', 'asin', 'fnsku', 'operational_pool',
    'seller_sku_aliases', 'observed_marketplaces', 'reserved_quantity',
    'pending_customer_order_quantity', 'pending_transshipment_quantity',
    'fc_processing_quantity', 'inbound_working_quantity',
    'inbound_shipped_quantity', 'inbound_receiving_quantity',
    'inbound_total_quantity', 'amazon_last_updated_time', 'confidence'
  ]);

SELECT 'CANONICAL_GRAIN_INDEX' AS check_name,
       indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'uq_amz_fba_inventory_canonical_grain';

SELECT 'CANONICAL_CONSTRAINTS' AS check_name,
       conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (
  'public.amazon_fba_inventory_snapshot_runs'::regclass,
  'public.amazon_fba_inventory_snapshots'::regclass
)
AND (
  conrelid = 'public.amazon_fba_inventory_snapshot_runs'::regclass
  OR conname LIKE 'amazon_fba_inventory_snapshots_%_check'
)
ORDER BY conrelid::regclass::text, conname;

SELECT public.commit_amazon_fba_inventory_snapshot_run(
  'a1a1a1a1-0000-4000-8000-000000000001'::uuid,
  clock_timestamp(),
  ARRAY['ES', 'DE', 'FR', 'IT', 'PL', 'SE', 'UK'],
  19,
  jsonb_build_array(
    jsonb_build_object(
      'marketplace_id', 'EU', 'sku_original', 'f8436616610104',
      'sku_limpio', 'f8436616610104', 'producto_id', NULL,
      'asin', 'B0DJBQGKBT', 'fnsku', 'X00259GEWP', 'operational_pool', 'EU',
      'seller_sku_aliases', jsonb_build_array('f8436616610104'),
      'observed_marketplaces', jsonb_build_array('ES', 'DE', 'FR', 'IT', 'PL', 'SE'),
      'fulfillable_quantity', 84, 'reserved_quantity', 5,
      'pending_customer_order_quantity', 0, 'pending_transshipment_quantity', 0,
      'fc_processing_quantity', 0, 'inbound_working_quantity', 0,
      'inbound_shipped_quantity', 0, 'inbound_receiving_quantity', 0,
      'inbound_total_quantity', 0, 'unfulfillable_quantity', 5,
      'researching_quantity', 0, 'total_quantity_raw', 94,
      'amazon_last_updated_time', clock_timestamp(),
      'row_fingerprint', 'tx-fixture-alaia-x00259gewp', 'raw', '{}'::jsonb
    ),
    jsonb_build_object(
      'marketplace_id', 'EU', 'sku_original', 'f8436616610104UK',
      'sku_limpio', 'f8436616610104UK', 'producto_id', NULL,
      'asin', 'B0DJBQGKBT', 'fnsku', 'B0DJBQGKBT', 'operational_pool', 'EU',
      'seller_sku_aliases', jsonb_build_array('f8436616610104UK', 'Amazon.Found.B0DJBQGKBT'),
      'observed_marketplaces', jsonb_build_array('ES', 'DE', 'FR', 'IT', 'PL', 'SE'),
      'fulfillable_quantity', 624, 'reserved_quantity', 3,
      'pending_customer_order_quantity', 0, 'pending_transshipment_quantity', 0,
      'fc_processing_quantity', 0, 'inbound_working_quantity', 0,
      'inbound_shipped_quantity', 669, 'inbound_receiving_quantity', 0,
      'inbound_total_quantity', 669, 'unfulfillable_quantity', 0,
      'researching_quantity', 0, 'total_quantity_raw', 1296,
      'amazon_last_updated_time', clock_timestamp(),
      'row_fingerprint', 'tx-fixture-alaia-b0djbqgkbt', 'raw', '{}'::jsonb
    ),
    jsonb_build_object(
      'marketplace_id', 'UK', 'sku_original', 'tx-uk-provenance',
      'sku_limpio', 'tx-uk-provenance', 'producto_id', NULL,
      'asin', 'B0DJBQGKBT', 'fnsku', 'B0DJBQGKBT', 'operational_pool', 'UK',
      'seller_sku_aliases', jsonb_build_array('tx-uk-provenance'),
      'observed_marketplaces', jsonb_build_array('UK'),
      'fulfillable_quantity', 10, 'reserved_quantity', 1,
      'pending_customer_order_quantity', 0, 'pending_transshipment_quantity', 0,
      'fc_processing_quantity', 0, 'inbound_working_quantity', 0,
      'inbound_shipped_quantity', 0, 'inbound_receiving_quantity', 0,
      'inbound_total_quantity', 0, 'unfulfillable_quantity', 0,
      'researching_quantity', 0, 'total_quantity_raw', 11,
      'amazon_last_updated_time', clock_timestamp(),
      'row_fingerprint', 'tx-fixture-alaia-uk-separate-pool', 'raw', '{}'::jsonb
    )
  )
) AS committed_canonical_rows;

SELECT 'ALAIA_EU' AS check_name,
       fba_available, fba_reserved, inbound_working, inbound_shipped,
       inbound_receiving, fba_inbound, fba_unfulfillable,
       fba_researching, unique_fnsku_count, confidence, freshness
FROM public.v_latest_amazon_fba_inventory_by_product_pool
WHERE producto_id IS NULL
  AND asin = 'B0DJBQGKBT'
  AND operational_pool = 'EU';

SELECT 'ALAIA_PROVENANCE' AS check_name,
       count(DISTINCT fnsku) AS quantitative_grains,
       count(DISTINCT fnsku) AS unique_fnsku,
       array_agg(DISTINCT marketplace ORDER BY marketplace) AS observed_marketplaces
FROM public.v_latest_amazon_fba_inventory_snapshot s
CROSS JOIN LATERAL unnest(s.observed_marketplaces) marketplace
WHERE s.asin = 'B0DJBQGKBT' AND s.operational_pool = 'EU';

SELECT 'ALAIA_ALIASES' AS check_name,
       count(DISTINCT alias) AS unique_aliases,
       array_agg(DISTINCT alias ORDER BY alias) AS seller_sku_aliases
FROM public.v_latest_amazon_fba_inventory_snapshot s
CROSS JOIN LATERAL unnest(s.seller_sku_aliases) alias
WHERE s.asin = 'B0DJBQGKBT' AND s.operational_pool = 'EU';

SELECT 'EU_UK_SEPARATE' AS check_name,
       count(*) AS pool_rows,
       array_agg(operational_pool ORDER BY operational_pool) AS pools,
       bool_and(operational_pool IN ('EU', 'UK')) AS pools_valid
FROM public.v_latest_amazon_fba_inventory_by_product_pool
WHERE producto_id IS NULL AND asin = 'B0DJBQGKBT';

SELECT 'NO_GLOBAL_TOTAL' AS check_name,
       count(*) = 0 AS no_unsafe_total_column
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'v_latest_amazon_fba_inventory_by_product_pool'
  AND column_name LIKE 'total_fba%';

DO $$
BEGIN
  BEGIN
    INSERT INTO public.amazon_fba_inventory_snapshots (
      snapshot_run_id, snapshot_at, observed_at, marketplace_id,
      sku_original, sku_limpio, asin, fnsku, operational_pool,
      fulfillable_quantity, reserved_quantity, inbound_working_quantity,
      inbound_shipped_quantity, inbound_receiving_quantity,
      inbound_total_quantity, inbound_quantity, unfulfillable_quantity,
      researching_quantity, source, row_fingerprint, raw, imported_at
    ) VALUES (
      'a1a1a1a1-0000-4000-8000-000000000001', clock_timestamp(), clock_timestamp(), 'EU',
      'invalid-inbound', 'invalid-inbound', 'INVALIDASIN', 'INVALIDFNSKU', 'EU',
      0, 0, 10, 20, 5, 999, 999, 0, 0,
      'tx_validation', 'tx-invalid-inbound-total', '{}'::jsonb, clock_timestamp()
    );
    RAISE EXCEPTION 'INBOUND_CONSTRAINT_NOT_ENFORCED';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'INBOUND_INVALID_REJECTED';
  END;
END;
$$;

DO $$
DECLARE
  v_invalid_run uuid := 'a1a1a1a1-0000-4000-8000-000000000002'::uuid;
  v_row jsonb := jsonb_build_object(
    'marketplace_id', 'EU', 'sku_original', 'duplicate', 'sku_limpio', 'duplicate',
    'producto_id', NULL, 'asin', 'DUPLICATEASIN', 'fnsku', 'DUPLICATEFNSKU',
    'operational_pool', 'EU', 'seller_sku_aliases', jsonb_build_array('duplicate'),
    'observed_marketplaces', jsonb_build_array('ES'), 'fulfillable_quantity', 1,
    'reserved_quantity', 0, 'pending_customer_order_quantity', 0,
    'pending_transshipment_quantity', 0, 'fc_processing_quantity', 0,
    'inbound_working_quantity', 0, 'inbound_shipped_quantity', 0,
    'inbound_receiving_quantity', 0, 'inbound_total_quantity', 0,
    'unfulfillable_quantity', 0, 'researching_quantity', 0,
    'total_quantity_raw', 1, 'amazon_last_updated_time', clock_timestamp(),
    'row_fingerprint', 'tx-duplicate-a', 'raw', '{}'::jsonb
  );
BEGIN
  BEGIN
    PERFORM public.commit_amazon_fba_inventory_snapshot_run(
      v_invalid_run, clock_timestamp(), ARRAY['ES'], 2,
      jsonb_build_array(v_row, v_row || jsonb_build_object('row_fingerprint', 'tx-duplicate-b'))
    );
    RAISE EXCEPTION 'INVALID_RPC_WAS_NOT_REJECTED';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.amazon_fba_inventory_snapshot_runs WHERE id = v_invalid_run)
     OR EXISTS (SELECT 1 FROM public.amazon_fba_inventory_snapshots WHERE snapshot_run_id = v_invalid_run) THEN
    RAISE EXCEPTION 'INVALID_RPC_LEFT_PARTIAL_STATE';
  END IF;
  RAISE NOTICE 'INVALID_RPC_TRANSACTION_ABORTED_WITHOUT_PARTIAL_STATE';
END;
$$;

INSERT INTO public.amazon_fba_inventory_snapshot_runs (
  id, observed_at, completed_at, status, marketplace_ids, raw_row_count, canonical_row_count
) VALUES (
  'a1a1a1a1-0000-4000-8000-000000000003',
  clock_timestamp() + interval '1 hour', clock_timestamp(), 'RUNNING', ARRAY['ES'], 0, 0
);

SELECT 'LATEST_COMPLETE_ONLY' AS check_name,
       (SELECT count(*) FROM public.v_latest_amazon_fba_inventory_snapshot
        WHERE snapshot_run_id = 'a1a1a1a1-0000-4000-8000-000000000003') = 0 AS running_hidden,
       (SELECT fba_available FROM public.v_latest_amazon_fba_inventory_by_product_pool
        WHERE producto_id IS NULL AND asin = 'B0DJBQGKBT' AND operational_pool = 'EU') = 708 AS complete_preserved;

SELECT 'FIXTURE_COUNTS_BEFORE_ROLLBACK' AS check_name,
       (SELECT count(*) FROM public.amazon_fba_inventory_snapshot_runs
        WHERE id::text LIKE 'a1a1a1a1-0000-4000-8000-%') AS test_runs,
       (SELECT count(*) FROM public.amazon_fba_inventory_snapshots
        WHERE snapshot_run_id::text LIKE 'a1a1a1a1-0000-4000-8000-%') AS test_rows;
