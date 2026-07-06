-- Módulo: logística / AMAZON_AGL.
-- Responsabilidad: limpiar el maestro de países y retirar estructuras legacy de destino.
-- No debe tocar stock, inventario_paises, forecast, contenedores entregados ni importadores.
-- Importante: no usa DROP CASCADE; si hay dependencias, informa con NOTICE y no fuerza.

ALTER TABLE public.paises
  ALTER COLUMN currency SET DEFAULT 'EUR';

UPDATE public.paises
SET currency = 'EUR'
WHERE currency IS NULL;

ALTER TABLE public.paises
  ALTER COLUMN currency SET NOT NULL;

UPDATE public.paises
SET activo = false
WHERE code = 'UK';

UPDATE public.paises
SET activo = true
WHERE code = 'GB';

DO $$
DECLARE
  dep RECORD;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contenedores'
      AND column_name = 'logistics_destination_type'
  ) THEN
    BEGIN
      ALTER TABLE public.contenedores
        DROP COLUMN IF EXISTS logistics_destination_type;
      RAISE NOTICE 'Columna public.contenedores.logistics_destination_type eliminada.';
    EXCEPTION
      WHEN dependent_objects_still_exist THEN
        RAISE NOTICE 'No se pudo eliminar logistics_destination_type por dependencias: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'Columna public.contenedores.logistics_destination_type no existe.';
  END IF;

  IF to_regclass('public.puerto_pais') IS NULL THEN
    RAISE NOTICE 'Tabla public.puerto_pais no existe.';
    RETURN;
  END IF;

  FOR dep IN
    SELECT
      COALESCE(cls.relkind::text, proc.prokind::text, con.contype::text, 'dependencia') AS tipo,
      COALESCE(
        quote_ident(ns.nspname) || '.' || quote_ident(cls.relname),
        quote_ident(proc_ns.nspname) || '.' || quote_ident(proc.proname),
        quote_ident(con_ns.nspname) || '.' || quote_ident(con.conname),
        d.objid::text
      ) AS objeto
    FROM pg_depend d
    LEFT JOIN pg_class cls ON cls.oid = d.objid
    LEFT JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    LEFT JOIN pg_proc proc ON proc.oid = d.objid
    LEFT JOIN pg_namespace proc_ns ON proc_ns.oid = proc.pronamespace
    LEFT JOIN pg_constraint con ON con.oid = d.objid
    LEFT JOIN pg_namespace con_ns ON con_ns.oid = con.connamespace
    WHERE d.refobjid = 'public.puerto_pais'::regclass
      AND d.deptype = 'n'
      AND COALESCE(cls.oid, proc.oid, con.oid) IS NOT NULL
  LOOP
    RAISE NOTICE 'Dependencia public.puerto_pais encontrada: tipo=%, objeto=%', dep.tipo, dep.objeto;
  END LOOP;

  BEGIN
    DROP TABLE IF EXISTS public.puerto_pais;
    RAISE NOTICE 'Tabla public.puerto_pais eliminada.';
  EXCEPTION
    WHEN dependent_objects_still_exist THEN
      RAISE NOTICE 'No se pudo eliminar public.puerto_pais por dependencias: %', SQLERRM;
  END;
END $$;
