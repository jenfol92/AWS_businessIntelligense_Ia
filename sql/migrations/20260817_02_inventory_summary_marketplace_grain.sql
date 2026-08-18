BEGIN;

ALTER TABLE public.amazon_fba_inventory_snapshots
  ADD COLUMN IF NOT EXISTS seller_sku_original text NULL;
ALTER TABLE public.amazon_fba_inventory_snapshots
  ADD COLUMN IF NOT EXISTS condition text NULL;

ALTER TABLE public.amazon_fba_inventory_snapshots
  DROP CONSTRAINT IF EXISTS amazon_fba_inventory_snapshots_inbound_total_check,
  ADD CONSTRAINT amazon_fba_inventory_snapshots_inbound_total_check CHECK (
    inbound_total_quantity = inbound_working_quantity + inbound_shipped_quantity + inbound_receiving_quantity
  );

DROP INDEX IF EXISTS public.uq_amz_fba_inventory_canonical_grain;

CREATE UNIQUE INDEX IF NOT EXISTS uq_amz_fba_inventory_canonical_grain_marketplace_sku
  ON public.amazon_fba_inventory_snapshots
    (snapshot_run_id, seller_sku_original, marketplace_id, asin, fnsku)
  WHERE snapshot_run_id IS NOT NULL
    AND seller_sku_original IS NOT NULL
    AND marketplace_id IS NOT NULL;

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
    seller_sku_original, sku_original, sku_limpio, producto_id, asin, fnsku, condition, operational_pool,
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
    r.seller_sku_original, r.sku_original, r.sku_limpio, r.producto_id, r.asin, r.fnsku, r.condition, r.operational_pool,
    r.seller_sku_aliases, r.observed_marketplaces, r.fulfillable_quantity,
    r.reserved_quantity, r.pending_customer_order_quantity,
    r.pending_transshipment_quantity, r.fc_processing_quantity,
    r.inbound_working_quantity, r.inbound_shipped_quantity,
    r.inbound_receiving_quantity, r.inbound_total_quantity, r.inbound_total_quantity,
    r.unfulfillable_quantity, r.researching_quantity, r.total_quantity_raw,
    r.amazon_last_updated_time, 'spapi_fba_inventory_summaries', 'TRUSTED', NULL,
    r.row_fingerprint, r.raw, p_observed_at
  FROM jsonb_to_recordset(p_rows) AS r(
    marketplace_id text, seller_sku_original text, sku_original text, sku_limpio text, producto_id uuid,
    asin text, fnsku text, condition text, operational_pool text, seller_sku_aliases text[],
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

CREATE OR REPLACE VIEW public.v_latest_amazon_fba_inventory_by_product_marketplace AS
SELECT
  producto_id,
  sku_limpio,
  marketplace_id,
  sum(fulfillable_quantity)::bigint AS fba_available,
  sum(reserved_quantity)::bigint AS fba_reserved,
  sum(inbound_working_quantity)::bigint AS inbound_working,
  sum(inbound_shipped_quantity)::bigint AS inbound_shipped,
  sum(inbound_receiving_quantity)::bigint AS inbound_receiving,
  sum(inbound_total_quantity)::bigint AS fba_inbound,
  sum(unfulfillable_quantity)::bigint AS fba_unfulfillable,
  sum(researching_quantity)::bigint AS fba_researching,
  count(*)::integer AS seller_sku_row_count,
  count(DISTINCT asin)::integer AS asin_count,
  count(DISTINCT fnsku)::integer AS fnsku_count,
  max(observed_at) AS observed_at,
  max(amazon_last_updated_time) AS amazon_last_updated_time,
  CASE WHEN bool_and(confidence = 'TRUSTED') THEN 'TRUSTED' ELSE 'UNAVAILABLE' END AS confidence
FROM public.v_latest_amazon_fba_inventory_snapshot
GROUP BY producto_id, sku_limpio, marketplace_id;

COMMENT ON VIEW public.v_latest_amazon_fba_inventory_by_product_marketplace IS
  'Disponibilidad FBA por producto, SKU limpio y marketplace. No representa ubicación física ni suma marketplaces.';

COMMIT;
