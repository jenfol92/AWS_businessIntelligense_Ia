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

CREATE OR REPLACE FUNCTION public.upsert_current_factory_cost_by_currency(
  p_producto_id uuid,
  p_moneda text,
  p_monto numeric,
  p_proveedor_id uuid DEFAULT NULL,
  p_arancel_porcentaje numeric DEFAULT NULL,
  p_fecha date DEFAULT CURRENT_DATE
)
RETURNS public.producto_costos
LANGUAGE plpgsql
AS $$
DECLARE
  v_moneda text := upper(trim(coalesce(p_moneda, '')));
  v_row public.producto_costos;
BEGIN
  IF v_moneda NOT IN ('USD', 'EUR', 'GBP', 'CNY') THEN
    RAISE EXCEPTION 'Moneda de coste no valida: %', coalesce(p_moneda, '(null)')
      USING ERRCODE = '22023';
  END IF;

  IF p_producto_id IS NULL THEN
    RAISE EXCEPTION 'producto_id es obligatorio'
      USING ERRCODE = '23502';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.productos p
    WHERE p.id = p_producto_id
  ) THEN
    RAISE EXCEPTION 'Producto no existe: %', p_producto_id
      USING ERRCODE = '23503';
  END IF;

  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'El coste vigente requiere monto positivo'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.producto_costos (
    producto_id,
    proveedor_id,
    costo_fabrica_monto,
    costo_fabrica_moneda,
    arancel_porcentaje,
    fecha,
    contenedor_id,
    lote_producto
  )
  VALUES (
    p_producto_id,
    p_proveedor_id,
    p_monto,
    v_moneda,
    p_arancel_porcentaje,
    coalesce(p_fecha, CURRENT_DATE),
    NULL,
    NULL
  )
  ON CONFLICT (producto_id, costo_fabrica_moneda)
  WHERE contenedor_id IS NULL
    AND lote_producto IS NULL
  DO UPDATE SET
    proveedor_id = coalesce(EXCLUDED.proveedor_id, producto_costos.proveedor_id),
    costo_fabrica_monto = EXCLUDED.costo_fabrica_monto,
    arancel_porcentaje = coalesce(EXCLUDED.arancel_porcentaje, producto_costos.arancel_porcentaje),
    fecha = EXCLUDED.fecha
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_current_factory_cost_by_currency(
  uuid,
  text,
  numeric,
  uuid,
  numeric,
  date
) TO authenticated, service_role;
