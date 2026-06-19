-- Evita doble aplicación activa de stock para el mismo producto/país/canal en un contenedor.

CREATE UNIQUE INDEX IF NOT EXISTS ux_contenedor_stock_aplicado_activo
  ON public.contenedor_stock_aplicado (contenedor_id, producto_id, pais, canal)
  WHERE revertido_at IS NULL;

COMMENT ON INDEX public.ux_contenedor_stock_aplicado_activo IS
  'Idempotencia: una sola fila activa por contenedor + producto + país + canal.';
