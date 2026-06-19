-- Añadir columnas de costes logísticos a la tabla contenedores
ALTER TABLE public.contenedores
  ADD COLUMN IF NOT EXISTS gastos_llegada_puerto float8 NULL,
  ADD COLUMN IF NOT EXISTS flete                 float8 NULL;

COMMENT ON COLUMN public.contenedores.gastos_llegada_puerto IS 'Gastos en destino (manipulación, aduanas, terminal) en EUR';
COMMENT ON COLUMN public.contenedores.flete                 IS 'Coste del flete marítimo en EUR';
