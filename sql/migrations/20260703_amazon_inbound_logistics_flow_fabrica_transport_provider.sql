-- Separar ruta fisica de transporte en shipments Amazon inbound.
-- No toca stock, inventario_paises, forecast ni contenedores.

ALTER TABLE public.amazon_inbound_shipments
  ADD COLUMN IF NOT EXISTS logistics_flow text NULL;

ALTER TABLE public.amazon_inbound_shipments
  ADD COLUMN IF NOT EXISTS transport_provider text NULL;

ALTER TABLE public.amazon_inbound_shipments
  DROP CONSTRAINT IF EXISTS amazon_inbound_shipments_logistics_flow_check;

UPDATE public.amazon_inbound_shipments
SET logistics_flow = 'fabrica_a_amazon'
WHERE logistics_flow = 'proveedor_a_amazon';

UPDATE public.amazon_inbound_shipments
SET transport_provider = 'amazon_agl',
    logistics_flow = NULL
WHERE logistics_flow = 'amazon_agl'
  AND transport_provider IS NULL;

UPDATE public.amazon_inbound_shipments
SET transport_provider = 'propio'
WHERE transport_provider IN ('fabrica', 'transitario', 'desconocido');

UPDATE public.amazon_inbound_shipments
SET logistics_flow = 'fabrica_a_amazon',
    transport_provider = 'amazon_agl'
WHERE shipment_id = 'FBA15LRLT63R';

ALTER TABLE public.amazon_inbound_shipments
  ADD CONSTRAINT amazon_inbound_shipments_logistics_flow_check
  CHECK (
    logistics_flow IS NULL
    OR logistics_flow IN (
      'fabrica_a_amazon',
      'almacen_a_amazon',
      'desconocido'
    )
  );

ALTER TABLE public.amazon_inbound_shipments
  DROP CONSTRAINT IF EXISTS amazon_inbound_shipments_transport_provider_check;

ALTER TABLE public.amazon_inbound_shipments
  ADD CONSTRAINT amazon_inbound_shipments_transport_provider_check
  CHECK (
    transport_provider IS NULL
    OR transport_provider IN (
      'amazon_agl',
      'propio'
    )
  );

NOTIFY pgrst, 'reload schema';
