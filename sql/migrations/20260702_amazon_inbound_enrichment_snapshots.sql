CREATE TABLE IF NOT EXISTS public.amazon_inbound_shipment_amazon_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id text NOT NULL,
  source text NOT NULL,
  payload jsonb NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  fetch_status text NOT NULL,
  error_message text NULL
);

CREATE INDEX IF NOT EXISTS idx_amazon_inbound_details_shipment
  ON public.amazon_inbound_shipment_amazon_details(shipment_id, fetched_at DESC);

CREATE TABLE IF NOT EXISTS public.amazon_inbound_shipment_amazon_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id text NOT NULL,
  source text NOT NULL,
  charge_type text NULL,
  amount numeric NULL,
  currency text NULL,
  payload jsonb NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  fetch_status text NOT NULL,
  error_message text NULL
);

CREATE INDEX IF NOT EXISTS idx_amazon_inbound_charges_shipment
  ON public.amazon_inbound_shipment_amazon_charges(shipment_id, fetched_at DESC);
