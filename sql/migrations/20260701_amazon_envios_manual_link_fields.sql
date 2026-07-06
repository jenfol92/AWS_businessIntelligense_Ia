-- Modulo: Amazon AGL.
-- Responsabilidad: campos de auditoria para vinculacion manual shipment -> contenedor.
-- No toca stock, inventario_paises, forecast ni estados logisticos.

ALTER TABLE public.amazon_envios
  ADD COLUMN IF NOT EXISTS link_status text,
  ADD COLUMN IF NOT EXISTS link_confidence numeric,
  ADD COLUMN IF NOT EXISTS link_notes text,
  ADD COLUMN IF NOT EXISTS linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS linked_by uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_amazon_envios_link_status
  ON public.amazon_envios(link_status);

CREATE INDEX IF NOT EXISTS idx_amazon_envios_linked_by
  ON public.amazon_envios(linked_by);
