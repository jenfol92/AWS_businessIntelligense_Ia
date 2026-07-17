-- Fase 1 costes: coste vigente unico por producto y moneda.
-- No aplicar hasta resolver los duplicados detectados por diagnostico SELECT-only.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.producto_costos
    WHERE contenedor_id IS NULL
      AND lote_producto IS NULL
    GROUP BY producto_id, costo_fabrica_moneda
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'No se puede crear ux_producto_costos_current_factory_by_currency: existen duplicados vigentes por producto y moneda.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_costos_current_factory_by_currency
ON public.producto_costos (producto_id, costo_fabrica_moneda)
WHERE contenedor_id IS NULL
  AND lote_producto IS NULL;
