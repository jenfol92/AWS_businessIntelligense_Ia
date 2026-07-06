-- Módulo: Amazon AGL.
-- Responsabilidad: asegurar idempotencia de sincronización inbound hacia amazon_envios.
-- No debe tocar stock, inventario_paises, forecast ni vínculos automáticos con contenedores.

CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_envios_shipment_sku
  ON public.amazon_envios(shipment_id, sku);
