-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 1: Facturación de contenedor y prorrateo de costes
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) contenedores: asegurar columna de coste de tránsito (€)
--    (flete y gastos_llegada_puerto ya añadidos previamente)
ALTER TABLE public.contenedores
  ADD COLUMN IF NOT EXISTS costo_transito_total_eur float8 NULL,
  ADD COLUMN IF NOT EXISTS facturado_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS facturado_by uuid NULL REFERENCES auth.users(id);

COMMENT ON COLUMN public.contenedores.costo_transito_total_eur IS 'Coste total de tránsito/seguro del contenedor en EUR';

-- 2) Renombrar tipo 'agc' → 'agl' en datos existentes
UPDATE public.contenedores
SET tipo_contenedor = 'agl'
WHERE tipo_contenedor = 'agc';

-- 3) (Opcional) Si tienes CHECK constraint del estado, actualízalo para permitir 'facturado'.
--    Se añade solo si la columna es un check; si usáis texto libre, no hace falta.
DO $$
DECLARE
  _con_name text;
BEGIN
  SELECT con.conname INTO _con_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname = 'contenedores'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%estado%';

  IF _con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.contenedores DROP CONSTRAINT %I', _con_name);
  END IF;

  ALTER TABLE public.contenedores
    ADD CONSTRAINT contenedores_estado_chk
    CHECK (estado IN ('preparando','en_transito','llegado','entregado','facturado','Borrador'));
EXCEPTION WHEN others THEN
  -- Si ya existe con ese nombre u otro conflicto, ignoramos
  NULL;
END $$;

-- 4) producto_costos: asegurar columnas de prorrateo
--    (ya creadas por el usuario, se dejan aquí idempotentes)
ALTER TABLE public.producto_costos
  ADD COLUMN IF NOT EXISTS contenedor_id uuid NULL REFERENCES public.contenedores(id),
  ADD COLUMN IF NOT EXISTS costo_flete_unit_eur          float8 NULL,
  ADD COLUMN IF NOT EXISTS gastos_llegada_puerto_eur_unit float8 NULL,
  ADD COLUMN IF NOT EXISTS transito_eur_unit             float8 NULL,
  ADD COLUMN IF NOT EXISTS costo_unitario_total_eur      float8 NULL;

COMMENT ON COLUMN public.producto_costos.contenedor_id IS 'Contenedor que originó este registro de coste (al facturar)';
COMMENT ON COLUMN public.producto_costos.costo_flete_unit_eur IS 'Flete prorrateado por CBM y dividido por unidad';
COMMENT ON COLUMN public.producto_costos.gastos_llegada_puerto_eur_unit IS 'Gastos en destino prorrateados por CBM y divididos por unidad';
COMMENT ON COLUMN public.producto_costos.transito_eur_unit IS 'Tránsito prorrateado por CBM y dividido por unidad';
COMMENT ON COLUMN public.producto_costos.costo_unitario_total_eur IS 'coste_fabrica_unit + flete_unit + gastos_llegada_unit + transito_unit';

-- Índice para acelerar consultas de coste por producto/fecha/contenedor
CREATE INDEX IF NOT EXISTS idx_producto_costos_prod_fecha
  ON public.producto_costos(producto_id, fecha DESC);

CREATE INDEX IF NOT EXISTS idx_producto_costos_contenedor
  ON public.producto_costos(contenedor_id);
