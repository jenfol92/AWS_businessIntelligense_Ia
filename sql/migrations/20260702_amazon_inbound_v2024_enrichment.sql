-- Amazon AGL v2024 enrichment.
-- Guarda relacion trazable entre shipment v0 (FBA...) y shipment interno v2024 (sh...).
-- No toca stock, inventario_paises, forecast ni contenedores.

ALTER TABLE public.amazon_inbound_shipments
  ADD COLUMN IF NOT EXISTS inbound_plan_id text NULL;

ALTER TABLE public.amazon_inbound_shipments
  ADD COLUMN IF NOT EXISTS amazon_shipment_id text NULL;

ALTER TABLE public.amazon_inbound_shipments
  ADD COLUMN IF NOT EXISTS amazon_reference_id text NULL;

ALTER TABLE public.amazon_inbound_shipments
  ADD COLUMN IF NOT EXISTS v2024_enrichment jsonb NULL;

CREATE INDEX IF NOT EXISTS idx_amazon_inbound_shipments_inbound_plan
  ON public.amazon_inbound_shipments(inbound_plan_id);

CREATE INDEX IF NOT EXISTS idx_amazon_inbound_shipments_amazon_shipment
  ON public.amazon_inbound_shipments(amazon_shipment_id);
