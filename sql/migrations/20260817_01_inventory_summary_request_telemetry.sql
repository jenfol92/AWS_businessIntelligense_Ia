BEGIN;

CREATE TABLE IF NOT EXISTS public.amazon_inventory_summary_request_telemetry (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attempt_id uuid NOT NULL,
  request_sequence integer NOT NULL CHECK (request_sequence > 0),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  marketplace_id text NOT NULL,
  operational_pool text NOT NULL CHECK (operational_pool IN ('EU', 'UK', 'UNKNOWN')),
  batch_number integer NOT NULL CHECK (batch_number > 0),
  seller_sku_count integer NOT NULL CHECK (seller_sku_count > 0),
  seller_skus_hash text NOT NULL,
  page_number integer NOT NULL CHECK (page_number > 0),
  http_status integer NULL,
  amazon_request_id text NULL,
  observed_rate_limit text NULL,
  retry_after text NULL,
  next_token_present boolean NULL,
  result_count integer NULL CHECK (result_count IS NULL OR result_count >= 0),
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILED', 'RATE_LIMITED', 'UNEXPECTED_FILTERED_PAGINATION')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, request_sequence)
);

CREATE INDEX IF NOT EXISTS idx_amazon_inventory_request_telemetry_attempt
  ON public.amazon_inventory_summary_request_telemetry (attempt_id, request_sequence);

COMMIT;
