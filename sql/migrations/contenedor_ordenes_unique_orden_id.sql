-- Una orden de compra solo puede estar vinculada a un contenedor.
-- Ejecutar sql/diagnostics/contenedor_ordenes_ordenes_duplicadas.sql antes.
-- Si hay filas duplicadas, limpiar manualmente antes de aplicar este script.

CREATE UNIQUE INDEX IF NOT EXISTS ux_contenedor_ordenes_orden_id_unico
ON public.contenedor_ordenes (orden_id);

COMMENT ON INDEX public.ux_contenedor_ordenes_orden_id_unico IS
  'Impide que una misma orden de compra esté vinculada a más de un contenedor.';
