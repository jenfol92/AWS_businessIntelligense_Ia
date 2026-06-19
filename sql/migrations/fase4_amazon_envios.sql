-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 4: Importador de envíos de Amazon (CSV de Inventario / Envíos FBA)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.amazon_envios (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id          text        NOT NULL,                              -- FBA Shipment ID (FBA1234ABCD)
  shipment_name        text        NULL,
  sku                  text        NOT NULL,
  fnsku                text        NULL,
  asin                 text        NULL,
  producto_id          uuid        NULL REFERENCES public.productos(id),
  cantidad_enviada     int         NOT NULL DEFAULT 0,
  cantidad_recibida    int         NULL,
  destination_country  text        NULL,        -- ES / DE / FR / IT / UK / 'varios' / ...
  destination_center   text        NULL,        -- p.ej. MAD9, BCN4...
  fecha_creacion       date        NULL,
  fecha_cerrado        date        NULL,
  estado               text        NULL,        -- WORKING / SHIPPED / DELIVERED / CLOSED / CANCELLED
  contenedor_id        uuid        NULL REFERENCES public.contenedores(id) ON DELETE SET NULL,
  matched_by           text        NULL,        -- 'auto' | 'manual'
  raw                  jsonb       NULL,
  imported_at          timestamptz NOT NULL DEFAULT now(),
  imported_by          uuid        NULL REFERENCES auth.users(id)
);

-- Una fila por (shipment_id, sku): si se reimporta se actualiza
CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_envios_shipment_sku
  ON public.amazon_envios(shipment_id, sku);

CREATE INDEX IF NOT EXISTS idx_amazon_envios_contenedor
  ON public.amazon_envios(contenedor_id);

CREATE INDEX IF NOT EXISTS idx_amazon_envios_sku
  ON public.amazon_envios(sku);

CREATE INDEX IF NOT EXISTS idx_amazon_envios_producto
  ON public.amazon_envios(producto_id);

COMMENT ON TABLE public.amazon_envios IS
  'Líneas de envíos FBA importadas desde Seller Central (CSV Inventario → Envíos). Se ligan manualmente a contenedores.';
