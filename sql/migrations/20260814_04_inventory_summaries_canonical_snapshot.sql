BEGIN;

CREATE TABLE IF NOT EXISTS public.amazon_fba_inventory_snapshot_runs (
  id uuid PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('RUNNING', 'COMPLETE', 'FAILED')),
  marketplace_ids text[] NOT NULL DEFAULT '{}'::text[],
  raw_row_count integer NOT NULL CHECK (raw_row_count >= 0),
  canonical_row_count integer NOT NULL CHECK (canonical_row_count >= 0),
  source text NOT NULL DEFAULT 'spapi_fba_inventory_summaries'
);

ALTER TABLE public.amazon_fba_inventory_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_run_id uuid NULL REFERENCES public.amazon_fba_inventory_snapshot_runs(id),
  ADD COLUMN IF NOT EXISTS observed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS asin text NULL,
  ADD COLUMN IF NOT EXISTS fnsku text NULL,
  ADD COLUMN IF NOT EXISTS operational_pool text NULL,
  ADD COLUMN IF NOT EXISTS seller_sku_aliases text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS observed_marketplaces text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS pending_customer_order_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_transshipment_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fc_processing_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inbound_working_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inbound_shipped_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inbound_receiving_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inbound_total_quantity integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_quantity_raw integer NULL,
  ADD COLUMN IF NOT EXISTS amazon_last_updated_time timestamptz NULL,
  ADD COLUMN IF NOT EXISTS confidence text NULL,
  ADD COLUMN IF NOT EXISTS conflict_metadata jsonb NULL;

ALTER TABLE public.amazon_fba_inventory_snapshots
  DROP CONSTRAINT IF EXISTS amazon_fba_inventory_snapshots_operational_pool_check,
  ADD CONSTRAINT amazon_fba_inventory_snapshots_operational_pool_check
    CHECK (operational_pool IS NULL OR operational_pool IN ('EU', 'UK')),
  DROP CONSTRAINT IF EXISTS amazon_fba_inventory_snapshots_confidence_check,
  ADD CONSTRAINT amazon_fba_inventory_snapshots_confidence_check
    CHECK (confidence IS NULL OR confidence IN ('TRUSTED', 'FNSKU_CONFLICT', 'INCOMPLETE')),
  DROP CONSTRAINT IF EXISTS amazon_fba_inventory_snapshots_inbound_total_check,
  ADD CONSTRAINT amazon_fba_inventory_snapshots_inbound_total_check CHECK (
    inbound_total_quantity = inbound_working_quantity + inbound_shipped_quantity + inbound_receiving_quantity
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_amz_fba_inventory_canonical_grain
  ON public.amazon_fba_inventory_snapshots (snapshot_run_id, operational_pool, asin, fnsku)
  WHERE snapshot_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_amz_fba_inventory_pool_product_observed
  ON public.amazon_fba_inventory_snapshots (operational_pool, producto_id, observed_at DESC)
  WHERE snapshot_run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.commit_amazon_fba_inventory_snapshot_run(
  p_run_id uuid,
  p_observed_at timestamptz,
  p_marketplace_ids text[],
  p_raw_row_count integer,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'CANONICAL_INVENTORY_ROWS_MUST_BE_ARRAY';
  END IF;

  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_rows);
  IF v_count = 0 OR p_raw_row_count < v_count THEN
    RAISE EXCEPTION 'CANONICAL_INVENTORY_INVALID_ROW_COUNTS raw=% canonical=%', p_raw_row_count, v_count;
  END IF;

  INSERT INTO public.amazon_fba_inventory_snapshot_runs (
    id, observed_at, status, marketplace_ids, raw_row_count, canonical_row_count
  ) VALUES (
    p_run_id, p_observed_at, 'COMPLETE', p_marketplace_ids, p_raw_row_count, v_count
  );

  INSERT INTO public.amazon_fba_inventory_snapshots (
    snapshot_run_id, snapshot_at, observed_at, marketplace_id, country,
    sku_original, sku_limpio, producto_id, asin, fnsku, operational_pool,
    seller_sku_aliases, observed_marketplaces, fulfillable_quantity,
    reserved_quantity, pending_customer_order_quantity,
    pending_transshipment_quantity, fc_processing_quantity,
    inbound_working_quantity, inbound_shipped_quantity,
    inbound_receiving_quantity, inbound_total_quantity, inbound_quantity,
    unfulfillable_quantity, researching_quantity, total_quantity_raw,
    amazon_last_updated_time, source, confidence, conflict_metadata,
    row_fingerprint, raw, imported_at
  )
  SELECT
    p_run_id, p_observed_at, p_observed_at, r.marketplace_id, NULL,
    r.sku_original, r.sku_limpio, r.producto_id, r.asin, r.fnsku, r.operational_pool,
    r.seller_sku_aliases, r.observed_marketplaces, r.fulfillable_quantity,
    r.reserved_quantity, r.pending_customer_order_quantity,
    r.pending_transshipment_quantity, r.fc_processing_quantity,
    r.inbound_working_quantity, r.inbound_shipped_quantity,
    r.inbound_receiving_quantity, r.inbound_total_quantity, r.inbound_total_quantity,
    r.unfulfillable_quantity, r.researching_quantity, r.total_quantity_raw,
    r.amazon_last_updated_time, 'spapi_fba_inventory_summaries', 'TRUSTED', NULL,
    r.row_fingerprint, r.raw, p_observed_at
  FROM jsonb_to_recordset(p_rows) AS r(
    marketplace_id text, sku_original text, sku_limpio text, producto_id uuid,
    asin text, fnsku text, operational_pool text, seller_sku_aliases text[],
    observed_marketplaces text[], fulfillable_quantity integer,
    reserved_quantity integer, pending_customer_order_quantity integer,
    pending_transshipment_quantity integer, fc_processing_quantity integer,
    inbound_working_quantity integer, inbound_shipped_quantity integer,
    inbound_receiving_quantity integer, inbound_total_quantity integer,
    unfulfillable_quantity integer, researching_quantity integer,
    total_quantity_raw integer, amazon_last_updated_time timestamptz,
    row_fingerprint text, raw jsonb
  );

  RETURN v_count;
END;
$$;

CREATE OR REPLACE VIEW public.v_latest_amazon_fba_inventory_snapshot AS
WITH latest_run AS (
  SELECT id
  FROM public.amazon_fba_inventory_snapshot_runs
  WHERE status = 'COMPLETE'
  ORDER BY observed_at DESC, completed_at DESC
  LIMIT 1
)
SELECT
  s.producto_id, s.sku_original, s.sku_limpio, s.marketplace_id, s.country,
  s.snapshot_at, s.fulfillable_quantity, s.reserved_quantity,
  s.inbound_total_quantity AS inbound_quantity, s.unfulfillable_quantity,
  s.researching_quantity, s.source, s.raw, s.imported_at,
  s.snapshot_run_id, s.observed_at, s.asin, s.fnsku, s.operational_pool,
  s.seller_sku_aliases, s.observed_marketplaces,
  s.pending_customer_order_quantity, s.pending_transshipment_quantity,
  s.fc_processing_quantity, s.inbound_working_quantity,
  s.inbound_shipped_quantity, s.inbound_receiving_quantity,
  s.inbound_total_quantity, s.total_quantity_raw,
  s.amazon_last_updated_time, s.confidence, s.conflict_metadata
FROM public.amazon_fba_inventory_snapshots s
JOIN latest_run r ON r.id = s.snapshot_run_id;

CREATE OR REPLACE VIEW public.v_latest_amazon_fba_inventory_by_product_pool AS
SELECT
  producto_id, asin, operational_pool,
  sum(fulfillable_quantity)::bigint AS fba_available,
  sum(reserved_quantity)::bigint AS fba_reserved,
  sum(inbound_working_quantity)::bigint AS inbound_working,
  sum(inbound_shipped_quantity)::bigint AS inbound_shipped,
  sum(inbound_receiving_quantity)::bigint AS inbound_receiving,
  sum(inbound_total_quantity)::bigint AS fba_inbound,
  sum(unfulfillable_quantity)::bigint AS fba_unfulfillable,
  sum(researching_quantity)::bigint AS fba_researching,
  count(*)::integer AS unique_fnsku_count,
  max(observed_at) AS observed_at,
  max(amazon_last_updated_time) AS amazon_last_updated_time,
  CASE WHEN bool_and(confidence = 'TRUSTED') THEN 'TRUSTED' ELSE 'UNAVAILABLE' END AS confidence,
  CASE
    WHEN now() - max(observed_at) <= interval '24 hours' THEN 'FRESH'
    WHEN now() - max(observed_at) <= interval '72 hours' THEN 'AGING'
    ELSE 'STALE'
  END AS freshness
FROM public.v_latest_amazon_fba_inventory_snapshot
GROUP BY producto_id, asin, operational_pool;

COMMENT ON VIEW public.v_latest_amazon_fba_inventory_by_product_pool IS
  'Stock operativo FBA por producto/ASIN/pool. No representa distribucion fisica y no suma EU+UK automaticamente.';

COMMIT;
