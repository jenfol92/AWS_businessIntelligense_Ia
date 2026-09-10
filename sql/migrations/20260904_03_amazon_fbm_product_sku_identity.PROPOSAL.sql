-- PROPOSAL ONLY. Do not apply without a separately authorized migration step.
BEGIN;

ALTER TABLE public.amazon_fbm_inventory_snapshots
  ALTER COLUMN asin DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.commit_amazon_fbm_inventory_snapshot_run(
  p_run_id uuid,
  p_observed_at timestamptz,
  p_marketplace_id text,
  p_expected_identity_count integer,
  p_completed_identity_count integer,
  p_capture_complete boolean,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_observed_at IS NULL THEN RAISE EXCEPTION 'FBM_OBSERVED_AT_REQUIRED'; END IF;
  IF nullif(btrim(p_marketplace_id), '') IS NULL THEN RAISE EXCEPTION 'FBM_MARKETPLACE_REQUIRED'; END IF;
  IF p_expected_identity_count IS NULL OR p_expected_identity_count <= 0 THEN RAISE EXCEPTION 'FBM_EXPECTED_IDENTITY_COUNT_INVALID'; END IF;
  IF p_completed_identity_count IS NULL OR p_completed_identity_count < 0 THEN RAISE EXCEPTION 'FBM_COMPLETED_IDENTITY_COUNT_INVALID'; END IF;
  IF p_capture_complete IS DISTINCT FROM true OR p_completed_identity_count <> p_expected_identity_count THEN RAISE EXCEPTION 'FBM_CAPTURE_INCOMPLETE'; END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'FBM_CANONICAL_ROWS_MUST_BE_ARRAY'; END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_rows);
  IF p_completed_identity_count < v_count THEN RAISE EXCEPTION 'FBM_INVALID_ROW_COUNTS'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(producto_id uuid, sku_limpio text, seller_sku text, asin text, marketplace_id text, available_quantity integer, observed_at timestamptz)
    WHERE r.producto_id IS NULL OR nullif(btrim(r.sku_limpio), '') IS NULL OR nullif(btrim(r.seller_sku), '') IS NULL
      OR r.marketplace_id IS DISTINCT FROM p_marketplace_id OR r.available_quantity IS NULL OR r.available_quantity < 0
      OR r.observed_at IS NULL OR r.observed_at IS DISTINCT FROM p_observed_at) THEN RAISE EXCEPTION 'FBM_ROW_INVALID'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(seller_sku text) GROUP BY r.seller_sku HAVING count(*) > 1) THEN RAISE EXCEPTION 'FBM_DUPLICATE_SELLER_SKU'; END IF;
  INSERT INTO public.amazon_fbm_inventory_snapshot_runs(id, observed_at, marketplace_id, expected_identity_count, completed_identity_count, canonical_row_count, status, publication_ready)
    VALUES (p_run_id, p_observed_at, p_marketplace_id, p_expected_identity_count, p_completed_identity_count, v_count, 'COMPLETE', true);
  INSERT INTO public.amazon_fbm_inventory_snapshots(snapshot_run_id, producto_id, sku_limpio, seller_sku, asin, marketplace_id, available_quantity, observed_at)
    SELECT p_run_id, r.producto_id, r.sku_limpio, r.seller_sku, r.asin, r.marketplace_id, r.available_quantity, r.observed_at
    FROM jsonb_to_recordset(p_rows) AS r(producto_id uuid, sku_limpio text, seller_sku text, asin text, marketplace_id text, available_quantity integer, observed_at timestamptz);
  RETURN v_count;
END;
$$;

COMMIT;
