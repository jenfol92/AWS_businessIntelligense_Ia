BEGIN;

CREATE TABLE IF NOT EXISTS public.amazon_fbm_inventory_snapshot_runs (
  id uuid PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  marketplace_id text NOT NULL,
  expected_identity_count integer NOT NULL CHECK (expected_identity_count >= 0),
  completed_identity_count integer NOT NULL CHECK (completed_identity_count >= 0),
  canonical_row_count integer NOT NULL CHECK (canonical_row_count >= 0),
  status text NOT NULL DEFAULT 'COMPLETE' CHECK (status IN ('COMPLETE')),
  publication_ready boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.amazon_fbm_inventory_snapshots (
  snapshot_run_id uuid NOT NULL REFERENCES public.amazon_fbm_inventory_snapshot_runs(id) ON DELETE CASCADE,
  producto_id uuid NOT NULL REFERENCES public.productos(id),
  sku_limpio text NOT NULL,
  seller_sku text NOT NULL,
  asin text NOT NULL,
  marketplace_id text NOT NULL,
  available_quantity integer NOT NULL CHECK (available_quantity >= 0),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (snapshot_run_id, producto_id, marketplace_id, seller_sku),
  CONSTRAINT uq_amazon_fbm_snapshot_run_seller_sku
    UNIQUE (snapshot_run_id, marketplace_id, seller_sku)
);

CREATE OR REPLACE FUNCTION public.commit_amazon_fbm_inventory_snapshot_run(
  p_run_id uuid,
  p_observed_at timestamptz,
  p_marketplace_id text,
  p_expected_identity_count integer,
  p_completed_identity_count integer,
  p_capture_complete boolean,
  p_rows jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF p_observed_at IS NULL THEN
    RAISE EXCEPTION 'FBM_OBSERVED_AT_REQUIRED';
  END IF;
  IF nullif(btrim(p_marketplace_id), '') IS NULL THEN
    RAISE EXCEPTION 'FBM_MARKETPLACE_REQUIRED';
  END IF;
  IF p_completed_identity_count IS NULL OR p_completed_identity_count < 0 THEN
    RAISE EXCEPTION 'FBM_COMPLETED_IDENTITY_COUNT_INVALID';
  END IF;
  IF p_expected_identity_count IS NULL OR p_expected_identity_count <= 0 THEN
    RAISE EXCEPTION 'FBM_EXPECTED_IDENTITY_COUNT_INVALID';
  END IF;
  IF p_capture_complete IS DISTINCT FROM true
     OR p_completed_identity_count <> p_expected_identity_count THEN
    RAISE EXCEPTION 'FBM_CAPTURE_INCOMPLETE';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'FBM_CANONICAL_ROWS_MUST_BE_ARRAY';
  END IF;
  SELECT count(*) INTO v_count FROM jsonb_array_elements(p_rows);
  IF p_completed_identity_count < v_count THEN
    RAISE EXCEPTION 'FBM_INVALID_ROW_COUNTS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_rows) AS r(
      producto_id uuid, sku_limpio text, seller_sku text, asin text,
      marketplace_id text, available_quantity integer, observed_at timestamptz
    )
    WHERE r.producto_id IS NULL
       OR nullif(btrim(r.sku_limpio), '') IS NULL
       OR nullif(btrim(r.seller_sku), '') IS NULL
       OR nullif(btrim(r.asin), '') IS NULL
       OR r.marketplace_id IS DISTINCT FROM p_marketplace_id
       OR r.available_quantity IS NULL
       OR r.available_quantity < 0
       OR r.observed_at IS NULL
       OR r.observed_at IS DISTINCT FROM p_observed_at
  ) THEN
    RAISE EXCEPTION 'FBM_ROW_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_rows) AS r(seller_sku text)
    GROUP BY r.seller_sku
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'FBM_DUPLICATE_SELLER_SKU';
  END IF;

  INSERT INTO public.amazon_fbm_inventory_snapshot_runs(
    id, observed_at, marketplace_id, expected_identity_count,
    completed_identity_count, canonical_row_count,
    status, publication_ready
  ) VALUES (
    p_run_id, p_observed_at, p_marketplace_id, p_expected_identity_count,
    p_completed_identity_count, v_count,
    'COMPLETE', true
  );

  INSERT INTO public.amazon_fbm_inventory_snapshots(
    snapshot_run_id, producto_id, sku_limpio, seller_sku, asin,
    marketplace_id, available_quantity, observed_at
  ) SELECT p_run_id, r.producto_id, r.sku_limpio, r.seller_sku, r.asin,
           r.marketplace_id, r.available_quantity, r.observed_at
    FROM jsonb_to_recordset(p_rows) AS r(
      producto_id uuid, sku_limpio text, seller_sku text, asin text,
      marketplace_id text, available_quantity integer, observed_at timestamptz
    );
  RETURN v_count;
END;
$$;

CREATE OR REPLACE VIEW public.v_latest_amazon_fbm_inventory_by_product AS
WITH latest_runs AS (
  SELECT DISTINCT ON (marketplace_id) id, observed_at, marketplace_id
  FROM public.amazon_fbm_inventory_snapshot_runs
  WHERE status = 'COMPLETE' AND publication_ready = true
  ORDER BY marketplace_id, observed_at DESC, completed_at DESC
)
SELECT s.producto_id, s.marketplace_id,
       sum(s.available_quantity)::bigint AS stock_fbm,
       max(s.observed_at) AS observed_at,
       count(*)::integer AS seller_sku_count
FROM public.amazon_fbm_inventory_snapshots s
JOIN latest_runs r ON r.id = s.snapshot_run_id
GROUP BY s.producto_id, s.marketplace_id;

COMMIT;
