-- Idempotencia: un registro de coste por contenedor + producto + lote (lote null → '' en índice)
CREATE UNIQUE INDEX IF NOT EXISTS ux_producto_costos_contenedor_producto_lote
  ON public.producto_costos (contenedor_id, producto_id, COALESCE(lote_producto, ''))
  WHERE contenedor_id IS NOT NULL;

COMMENT ON INDEX public.ux_producto_costos_contenedor_producto_lote IS
  'Evita duplicar costes al facturar contenedor. Si lote_producto es null, usar orden_item.id como lote al escribir.';
