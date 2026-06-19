-- Añade el agente de compra a la orden.
-- Regla de negocio: el contenedor no guarda agente; lo muestra derivado de su orden vinculada.

ALTER TABLE public.ordenes_compra
  ADD COLUMN IF NOT EXISTS agente_id uuid REFERENCES public.agentes_compra(id);

CREATE INDEX IF NOT EXISTS idx_ordenes_compra_agente_id
  ON public.ordenes_compra(agente_id);

COMMENT ON COLUMN public.ordenes_compra.agente_id IS
  'Agente de compra asignado a la orden. Los contenedores lo derivan mediante contenedor_ordenes.';
