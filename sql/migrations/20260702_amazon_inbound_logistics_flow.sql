-- Clasificacion logistica de shipments Amazon inbound.
-- No toca stock, inventario_paises, forecast ni contenedores.

ALTER TABLE public.amazon_inbound_shipments
  ADD COLUMN IF NOT EXISTS logistics_flow text NULL;

ALTER TABLE public.amazon_inbound_shipments
  DROP CONSTRAINT IF EXISTS amazon_inbound_shipments_logistics_flow_check;

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
