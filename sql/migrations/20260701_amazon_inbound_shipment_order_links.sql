-- Modulo: Amazon AGL.
-- Responsabilidad: vinculo manual shipment Amazon inbound -> orden/proforma.
-- No toca stock, inventario_paises, forecast, contenedores ni estados logisticos.

CREATE TABLE IF NOT EXISTS public.amazon_inbound_shipment_order_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id text NOT NULL,
  orden_id uuid NOT NULL REFERENCES public.ordenes_compra(id),
  link_status text DEFAULT 'manual_linked',
  link_notes text,
  linked_at timestamptz DEFAULT now(),
  linked_by uuid NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE (shipment_id, orden_id)
);

CREATE INDEX IF NOT EXISTS idx_amazon_inbound_order_links_shipment
  ON public.amazon_inbound_shipment_order_links(shipment_id);

CREATE INDEX IF NOT EXISTS idx_amazon_inbound_order_links_orden
  ON public.amazon_inbound_shipment_order_links(orden_id);
