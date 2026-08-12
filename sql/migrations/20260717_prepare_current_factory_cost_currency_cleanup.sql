-- Fase 1 costes - preparacion previa antes del indice unico.
-- Orden interno:
-- 1) Validar monedas existentes.
-- 2) Normalizar trim + upper.
-- 3) Archivar duplicados vigentes antiguos.
-- 4) Eliminar solo duplicados vigentes antiguos.
-- 5) Verificar cero duplicados.
-- 6) Proteger moneda con CHECK.

BEGIN;

DO $$
DECLARE
  v_invalid text;
BEGIN
  SELECT string_agg(DISTINCT coalesce(costo_fabrica_moneda, '(NULL)'), ', ' ORDER BY coalesce(costo_fabrica_moneda, '(NULL)'))
  INTO v_invalid
  FROM public.producto_costos
  WHERE costo_fabrica_moneda IS NULL
     OR upper(trim(costo_fabrica_moneda)) NOT IN ('USD', 'EUR', 'GBP', 'CNY');

  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'Monedas invalidas en producto_costos antes de normalizar: %', v_invalid
      USING ERRCODE = '22023';
  END IF;
END $$;

UPDATE public.producto_costos
SET costo_fabrica_moneda = upper(trim(costo_fabrica_moneda))
WHERE costo_fabrica_moneda IS NOT NULL
  AND costo_fabrica_moneda <> upper(trim(costo_fabrica_moneda));

CREATE TABLE IF NOT EXISTS public.producto_costos_current_duplicate_archive (
  archive_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  proveedor_id uuid NULL,
  costo_fabrica_monto numeric NULL,
  costo_fabrica_moneda text NULL,
  fecha date NULL,
  original_created_at text NULL,
  archive_reason text NOT NULL,
  migration_origin text NOT NULL DEFAULT '20260717_prepare_current_factory_cost_currency_cleanup.sql',
  archived_at timestamptz NOT NULL DEFAULT now(),
  original_row jsonb NOT NULL
);

ALTER TABLE public.producto_costos_current_duplicate_archive
ADD COLUMN IF NOT EXISTS migration_origin text NOT NULL
DEFAULT '20260717_prepare_current_factory_cost_currency_cleanup.sql';

ALTER TABLE public.producto_costos_current_duplicate_archive
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.producto_costos_current_duplicate_archive
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.producto_costos_current_duplicate_archive
TO service_role;

-- Evita nuevas escrituras mientras se seleccionan, archivan y eliminan
-- los duplicados vigentes.
LOCK TABLE public.producto_costos IN SHARE ROW EXCLUSIVE MODE;

-- Archivar exactamente las filas antiguas duplicadas.
WITH ranked AS (
  SELECT
    pc.id,
    row_number() OVER (
      PARTITION BY pc.producto_id, pc.costo_fabrica_moneda
      ORDER BY
        pc.fecha DESC NULLS LAST,
        (to_jsonb(pc)->>'created_at') DESC NULLS LAST,
        pc.id DESC
    ) AS rn,
    count(*) OVER (
      PARTITION BY pc.producto_id, pc.costo_fabrica_moneda
    ) AS group_count
  FROM public.producto_costos pc
  WHERE pc.contenedor_id IS NULL
    AND pc.lote_producto IS NULL
),
to_archive AS (
  SELECT pc.*
  FROM ranked r
  JOIN public.producto_costos pc
    ON pc.id = r.id
  WHERE r.group_count > 1
    AND r.rn > 1
)
INSERT INTO public.producto_costos_current_duplicate_archive (
  original_id,
  producto_id,
  proveedor_id,
  costo_fabrica_monto,
  costo_fabrica_moneda,
  fecha,
  original_created_at,
  archive_reason,
  migration_origin,
  original_row
)
SELECT
  ta.id,
  ta.producto_id,
  ta.proveedor_id,
  ta.costo_fabrica_monto,
  ta.costo_fabrica_moneda,
  ta.fecha,
  to_jsonb(ta)->>'created_at',
  'duplicate_current_factory_cost_by_product_currency',
  '20260717_prepare_current_factory_cost_currency_cleanup.sql',
  to_jsonb(ta)
FROM to_archive ta
WHERE NOT EXISTS (
  SELECT 1
  FROM public.producto_costos_current_duplicate_archive existing
  WHERE existing.original_id = ta.id
    AND existing.migration_origin =
      '20260717_prepare_current_factory_cost_currency_cleanup.sql'
);

-- Verificar que todas las filas que se van a eliminar están archivadas.
DO $$
DECLARE
  v_expected integer;
  v_archived integer;
BEGIN
  WITH ranked AS (
    SELECT
      pc.id,
      row_number() OVER (
        PARTITION BY pc.producto_id, pc.costo_fabrica_moneda
        ORDER BY
          pc.fecha DESC NULLS LAST,
          (to_jsonb(pc)->>'created_at') DESC NULLS LAST,
          pc.id DESC
      ) AS rn,
      count(*) OVER (
        PARTITION BY pc.producto_id, pc.costo_fabrica_moneda
      ) AS group_count
    FROM public.producto_costos pc
    WHERE pc.contenedor_id IS NULL
      AND pc.lote_producto IS NULL
  )
  SELECT count(*)
  INTO v_expected
  FROM ranked
  WHERE group_count > 1
    AND rn > 1;

  WITH ranked AS (
    SELECT
      pc.id,
      row_number() OVER (
        PARTITION BY pc.producto_id, pc.costo_fabrica_moneda
        ORDER BY
          pc.fecha DESC NULLS LAST,
          (to_jsonb(pc)->>'created_at') DESC NULLS LAST,
          pc.id DESC
      ) AS rn,
      count(*) OVER (
        PARTITION BY pc.producto_id, pc.costo_fabrica_moneda
      ) AS group_count
    FROM public.producto_costos pc
    WHERE pc.contenedor_id IS NULL
      AND pc.lote_producto IS NULL
  )
  SELECT count(*)
  INTO v_archived
  FROM ranked r
  JOIN public.producto_costos_current_duplicate_archive a
    ON a.original_id = r.id
   AND a.migration_origin =
     '20260717_prepare_current_factory_cost_currency_cleanup.sql'
  WHERE r.group_count > 1
    AND r.rn > 1;

  IF v_archived <> v_expected THEN
    RAISE EXCEPTION
      'Archivo incompleto de duplicados: esperado %, archivado %',
      v_expected,
      v_archived
      USING ERRCODE = 'P0001';
  END IF;
END $$;

-- Eliminar únicamente las filas que actualmente son duplicadas antiguas
-- y que ya están archivadas.
WITH ranked AS (
  SELECT
    pc.id,
    row_number() OVER (
      PARTITION BY pc.producto_id, pc.costo_fabrica_moneda
      ORDER BY
        pc.fecha DESC NULLS LAST,
        (to_jsonb(pc)->>'created_at') DESC NULLS LAST,
        pc.id DESC
    ) AS rn,
    count(*) OVER (
      PARTITION BY pc.producto_id, pc.costo_fabrica_moneda
    ) AS group_count
  FROM public.producto_costos pc
  WHERE pc.contenedor_id IS NULL
    AND pc.lote_producto IS NULL
),
to_delete AS (
  SELECT id
  FROM ranked
  WHERE group_count > 1
    AND rn > 1
)
DELETE FROM public.producto_costos pc
USING to_delete d
WHERE pc.id = d.id
  AND pc.contenedor_id IS NULL
  AND pc.lote_producto IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.producto_costos_current_duplicate_archive a
    WHERE a.original_id = pc.id
      AND a.migration_origin =
        '20260717_prepare_current_factory_cost_currency_cleanup.sql'
  );


DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.producto_costos
    WHERE contenedor_id IS NULL
      AND lote_producto IS NULL
    GROUP BY producto_id, costo_fabrica_moneda
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Persisten duplicados vigentes despues de archivar/eliminar'
      USING ERRCODE = '23505';
  END IF;
END $$;

ALTER TABLE public.producto_costos
DROP CONSTRAINT IF EXISTS producto_costos_costo_fabrica_moneda_check;

ALTER TABLE public.producto_costos
ADD CONSTRAINT producto_costos_costo_fabrica_moneda_check
CHECK (
  costo_fabrica_moneda IS NOT NULL
  AND costo_fabrica_moneda IN ('USD', 'EUR', 'GBP', 'CNY')
);

COMMIT;
