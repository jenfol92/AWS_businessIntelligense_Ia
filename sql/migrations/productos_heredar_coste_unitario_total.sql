-- Migracion: herencia de coste unitario total para variantes de producto.
-- No copia costes ni recalcula historicos; solo agrega el flag de control.

BEGIN;

ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS heredar_coste_unitario_total boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.productos.heredar_coste_unitario_total IS
  'Si true y parent_id es NOT NULL, el coste unitario total efectivo del producto se toma del padre.';

COMMIT;
