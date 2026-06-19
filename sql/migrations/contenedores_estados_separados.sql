-- Separa estado logístico, stock y costes en contenedores.
-- Mantiene contenedores.estado como legacy/compatibilidad.

BEGIN;

-- 1) Columnas nuevas
ALTER TABLE public.contenedores
  ADD COLUMN IF NOT EXISTS estado_logistico text,
  ADD COLUMN IF NOT EXISTS estado_stock text,
  ADD COLUMN IF NOT EXISTS estado_costes text;

-- tipo_contenedor ya existe; normalizar valores legacy AGL
UPDATE public.contenedores
SET tipo_contenedor = 'amazon_agl'
WHERE lower(trim(coalesce(tipo_contenedor, ''))) IN ('agl', 'agc');

UPDATE public.contenedores
SET tipo_contenedor = 'propio'
WHERE tipo_contenedor IS NULL OR trim(tipo_contenedor) = '';

-- 2) Constraints
ALTER TABLE public.contenedores
  DROP CONSTRAINT IF EXISTS contenedores_estado_logistico_chk;

ALTER TABLE public.contenedores
  ADD CONSTRAINT contenedores_estado_logistico_chk
  CHECK (
    estado_logistico IS NULL OR estado_logistico IN (
      'borrador',
      'preparando',
      'en_puerto_salida',
      'en_transito',
      'en_puerto_destino',
      'entregado'
    )
  );

ALTER TABLE public.contenedores
  DROP CONSTRAINT IF EXISTS contenedores_estado_stock_chk;

ALTER TABLE public.contenedores
  ADD CONSTRAINT contenedores_estado_stock_chk
  CHECK (
    estado_stock IS NULL OR estado_stock IN (
      'pendiente_stock',
      'parcialmente_disponible',
      'disponible_stock',
      'incidencia_stock'
    )
  );

ALTER TABLE public.contenedores
  DROP CONSTRAINT IF EXISTS contenedores_estado_costes_chk;

ALTER TABLE public.contenedores
  ADD CONSTRAINT contenedores_estado_costes_chk
  CHECK (
    estado_costes IS NULL OR estado_costes IN (
      'costes_estimados',
      'costes_facturados',
      'costes_cerrados'
    )
  );

ALTER TABLE public.contenedores
  DROP CONSTRAINT IF EXISTS contenedores_tipo_contenedor_chk;

ALTER TABLE public.contenedores
  ADD CONSTRAINT contenedores_tipo_contenedor_chk
  CHECK (
    tipo_contenedor IS NULL OR tipo_contenedor IN ('propio', 'amazon_agl')
  );

-- 3) Backfill desde estado legacy
UPDATE public.contenedores
SET
  estado_logistico = CASE estado
    WHEN 'borrador'           THEN 'borrador'
    WHEN 'preparando'         THEN 'preparando'
    WHEN 'en_puerto_salida'   THEN 'en_puerto_salida'
    WHEN 'en_transito'        THEN 'en_transito'
    WHEN 'en_puerto_destino'  THEN 'en_puerto_destino'
    WHEN 'entregado'          THEN 'entregado'
    WHEN 'disponible_stock'   THEN 'entregado'
    WHEN 'facturado'          THEN 'entregado'
    ELSE 'borrador'
  END,
  estado_stock = CASE estado
    WHEN 'disponible_stock' THEN 'disponible_stock'
    WHEN 'facturado'        THEN 'disponible_stock'
    ELSE 'pendiente_stock'
  END,
  estado_costes = CASE estado
    WHEN 'facturado' THEN 'costes_facturados'
    ELSE 'costes_estimados'
  END
WHERE estado_logistico IS NULL
   OR estado_stock IS NULL
   OR estado_costes IS NULL;

COMMENT ON COLUMN public.contenedores.estado_logistico IS
  'Flujo logístico: borrador → preparando → en_puerto_salida → en_transito → en_puerto_destino → entregado';

COMMENT ON COLUMN public.contenedores.estado_stock IS
  'Stock del lote: pendiente_stock → parcialmente_disponible → disponible_stock | incidencia_stock';

COMMENT ON COLUMN public.contenedores.estado_costes IS
  'Costes del contenedor: costes_estimados → costes_facturados → costes_cerrados';

COMMENT ON COLUMN public.contenedores.estado IS
  'Legacy/compatibilidad. Preferir estado_logistico, estado_stock y estado_costes.';

COMMIT;
