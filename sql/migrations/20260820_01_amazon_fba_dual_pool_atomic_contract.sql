BEGIN;

-- EU remains the persisted compatibility label for the PAN_EU observation pool.
ALTER TABLE public.amazon_fba_inventory_snapshot_runs
  ADD COLUMN IF NOT EXISTS complete_operational_pools text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS identity_conflict_count integer NOT NULL DEFAULT 0
    CHECK (identity_conflict_count >= 0),
  ADD COLUMN IF NOT EXISTS publication_ready boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.amazon_fba_inventory_snapshots
    WHERE snapshot_run_id IS NOT NULL AND producto_id IS NOT NULL
    GROUP BY snapshot_run_id, producto_id, operational_pool, asin, fnsku
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'EXISTING_ROWS_VIOLATE_DUAL_POOL_CANONICAL_GRAIN';
  END IF;
END;
$$;

DROP INDEX IF EXISTS public.uq_amz_fba_inventory_canonical_grain_marketplace_sku;
DROP INDEX IF EXISTS public.uq_amz_fba_inventory_canonical_grain;

CREATE UNIQUE INDEX uq_amz_fba_inventory_canonical_physical_pool_grain
  ON public.amazon_fba_inventory_snapshots
    (snapshot_run_id, producto_id, operational_pool, asin, fnsku)
  WHERE snapshot_run_id IS NOT NULL AND producto_id IS NOT NULL;

-- New overload. The existing five-argument RPC remains available until the
-- current ES-only producer and the dual producer are activated together.
CREATE OR REPLACE FUNCTION public.commit_amazon_fba_inventory_snapshot_run(
  p_run_id uuid,
  p_observed_at timestamptz,
  p_marketplace_ids text[],
  p_raw_row_count integer,
  p_rows jsonb,
  p_pan_eu_complete boolean,
  p_uk_complete boolean,
  p_identity_conflict_count integer,
  p_ready_for_atomic_publication boolean
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_pan_eu_complete IS DISTINCT FROM true
     OR p_uk_complete IS DISTINCT FROM true
     OR p_ready_for_atomic_publication IS DISTINCT FROM true
     OR COALESCE(p_identity_conflict_count, 0) <> 0 THEN
    RAISE EXCEPTION 'DUAL_POOL_PUBLICATION_PRECONDITIONS_FAILED pan_eu=% uk=% conflicts=% ready=%',
      p_pan_eu_complete, p_uk_complete, p_identity_conflict_count, p_ready_for_atomic_publication;
  END IF;

  IF NOT (
    COALESCE(p_marketplace_ids, '{}'::text[]) @> ARRAY['A1RKKUPIHCS9HS', 'A1F83G8C2ARO7P']::text[]
    AND cardinality(p_marketplace_ids) = 2
  ) THEN
    RAISE EXCEPTION 'DUAL_POOL_MARKETPLACES_MUST_BE_ES_AND_GB';
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'CANONICAL_INVENTORY_ROWS_MUST_BE_ARRAY';
  END IF;

  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_rows);
  IF v_count = 0 OR p_raw_row_count < v_count THEN
    RAISE EXCEPTION 'CANONICAL_INVENTORY_INVALID_ROW_COUNTS raw=% canonical=%', p_raw_row_count, v_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS r(
      producto_id uuid, asin text, fnsku text, operational_pool text, marketplace_id text
    )
    WHERE r.producto_id IS NULL
       OR NULLIF(btrim(r.asin), '') IS NULL
       OR NULLIF(btrim(r.fnsku), '') IS NULL
       OR (r.operational_pool = 'EU' AND r.marketplace_id <> 'A1RKKUPIHCS9HS')
       OR (r.operational_pool = 'UK' AND r.marketplace_id <> 'A1F83G8C2ARO7P')
       OR r.operational_pool NOT IN ('EU', 'UK')
  ) THEN
    RAISE EXCEPTION 'DUAL_POOL_ROW_IDENTITY_OR_MARKETPLACE_INVALID';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS r(
      producto_id uuid, asin text, fnsku text, operational_pool text
    )
    GROUP BY r.producto_id, r.asin, r.fnsku, r.operational_pool
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_CANONICAL_PHYSICAL_IDENTITY_WITHIN_POOL';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(operational_pool text)
    WHERE r.operational_pool = 'EU'
  ) OR NOT EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(operational_pool text)
    WHERE r.operational_pool = 'UK'
  ) THEN
    RAISE EXCEPTION 'DUAL_POOL_ROWS_MUST_CONTAIN_EU_AND_UK';
  END IF;

  v_count := public.commit_amazon_fba_inventory_snapshot_run(
    p_run_id, p_observed_at, p_marketplace_ids, p_raw_row_count, p_rows
  );

  UPDATE public.amazon_fba_inventory_snapshot_runs
  SET complete_operational_pools = ARRAY['EU', 'UK']::text[],
      identity_conflict_count = p_identity_conflict_count,
      publication_ready = true
  WHERE id = p_run_id;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE VIEW public.v_latest_amazon_fba_inventory_by_product_operational_total AS
SELECT
  snapshot_run_id,
  producto_id,
  max(sku_limpio) AS sku_limpio,
  (sum(fulfillable_quantity) FILTER (WHERE operational_pool = 'EU'))::bigint AS stock_fba_pan_eu,
  (sum(fulfillable_quantity) FILTER (WHERE operational_pool = 'UK'))::bigint AS stock_fba_uk,
  sum(fulfillable_quantity)::bigint AS stock_fba_total,
  sum(reserved_quantity)::bigint AS reserved_total,
  sum(inbound_total_quantity)::bigint AS inbound_total,
  sum(unfulfillable_quantity)::bigint AS unfulfillable_total,
  count(DISTINCT asin)::integer AS asin_count,
  count(*) FILTER (WHERE operational_pool = 'EU')::integer AS pan_eu_physical_identity_count,
  count(*) FILTER (WHERE operational_pool = 'UK')::integer AS uk_physical_identity_count,
  max(observed_at) AS observed_at,
  bool_or(operational_pool = 'EU') AND bool_or(operational_pool = 'UK') AS dual_pool_complete
FROM public.v_latest_amazon_fba_inventory_snapshot
GROUP BY snapshot_run_id, producto_id;

COMMENT ON VIEW public.v_latest_amazon_fba_inventory_by_product_operational_total IS
  'Stock FBA operativo por producto: PAN_EU (persistido EU), UK y total. Un unico latest COMPLETE run; Ledger no interviene.';

COMMIT;
