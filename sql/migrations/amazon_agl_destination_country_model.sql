-- Rediseño destino AMAZON_AGL / propio.
-- No toca stock, inventario_paises, forecast ni importadores.
-- No usa DROP CASCADE.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.paises (
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  activo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.paises
  ADD COLUMN IF NOT EXISTS id uuid;

ALTER TABLE public.paises
  ADD COLUMN IF NOT EXISTS activo boolean DEFAULT true;

ALTER TABLE public.paises
  ADD COLUMN IF NOT EXISTS currency text;

UPDATE public.paises
SET currency = 'EUR'
WHERE currency IS NULL;

ALTER TABLE public.paises
  ALTER COLUMN currency SET DEFAULT 'EUR';

ALTER TABLE public.paises
  ALTER COLUMN currency SET NOT NULL;

UPDATE public.paises
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE public.paises
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.paises
  ALTER COLUMN id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS paises_id_key ON public.paises(id);
CREATE UNIQUE INDEX IF NOT EXISTS paises_code_key ON public.paises(code);

INSERT INTO public.paises (code, name, currency, activo)
VALUES
  ('ES', 'España', 'EUR', true),
  ('DE', 'Alemania', 'EUR', true),
  ('IT', 'Italia', 'EUR', true),
  ('FR', 'Francia', 'EUR', true),
  ('GB', 'Reino Unido', 'GBP', true),
  ('PL', 'Polonia', 'PLN', true),
  ('NL', 'Países Bajos', 'EUR', true),
  ('PT', 'Portugal', 'EUR', true)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  currency = COALESCE(public.paises.currency, EXCLUDED.currency),
  activo = COALESCE(public.paises.activo, EXCLUDED.activo);

DO $$
BEGIN
  IF to_regclass('public.puerto_pais') IS NOT NULL THEN
    INSERT INTO public.paises (code, name, currency, activo)
    SELECT DISTINCT
      upper(trim(pp.pais)) AS code,
      CASE upper(trim(pp.pais))
        WHEN 'ES' THEN 'España'
        WHEN 'DE' THEN 'Alemania'
        WHEN 'IT' THEN 'Italia'
        WHEN 'FR' THEN 'Francia'
        WHEN 'GB' THEN 'Reino Unido'
        WHEN 'UK' THEN 'Reino Unido'
        WHEN 'PL' THEN 'Polonia'
        WHEN 'NL' THEN 'Países Bajos'
        WHEN 'PT' THEN 'Portugal'
        ELSE upper(trim(pp.pais))
      END AS name,
      CASE upper(trim(pp.pais))
        WHEN 'GB' THEN 'GBP'
        WHEN 'UK' THEN 'GBP'
        WHEN 'PL' THEN 'PLN'
        ELSE 'EUR'
      END AS currency,
      true AS activo
    FROM public.puerto_pais pp
    WHERE nullif(trim(pp.pais), '') IS NOT NULL
    ON CONFLICT (code) DO UPDATE
    SET
      name = COALESCE(public.paises.name, EXCLUDED.name),
      currency = COALESCE(public.paises.currency, EXCLUDED.currency),
      activo = COALESCE(public.paises.activo, EXCLUDED.activo);
  END IF;
END $$;
ALTER TABLE public.contenedores
  ADD COLUMN IF NOT EXISTS destino_pais_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contenedores_destino_pais_id_fkey'
  ) THEN
    ALTER TABLE public.contenedores
      ADD CONSTRAINT contenedores_destino_pais_id_fkey
      FOREIGN KEY (destino_pais_id)
      REFERENCES public.paises(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contenedores_destino_pais_id
  ON public.contenedores(destino_pais_id);

ALTER TABLE public.amazon_marketplaces
  ADD COLUMN IF NOT EXISTS pais_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'amazon_marketplaces_pais_id_fkey'
  ) THEN
    ALTER TABLE public.amazon_marketplaces
      ADD CONSTRAINT amazon_marketplaces_pais_id_fkey
      FOREIGN KEY (pais_id)
      REFERENCES public.paises(id);
  END IF;
END $$;

DO $$
DECLARE
  country_column text;
BEGIN
  SELECT column_name
  INTO country_column
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'amazon_marketplaces'
    AND column_name IN ('code', 'country_code', 'marketplace_country')
  ORDER BY CASE column_name
    WHEN 'code' THEN 1
    WHEN 'country_code' THEN 2
    WHEN 'marketplace_country' THEN 3
    ELSE 9
  END
  LIMIT 1;

  IF country_column IS NULL THEN
    RAISE NOTICE 'amazon_marketplaces no tiene columna de país conocida para rellenar pais_id.';
  ELSE
    EXECUTE format(
      'UPDATE public.amazon_marketplaces am
       SET pais_id = p.id
       FROM public.paises p
       WHERE p.code = upper(trim(am.%I))
         AND am.pais_id IS NULL',
      country_column
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_amazon_marketplaces_pais_id
  ON public.amazon_marketplaces(pais_id);

-- Retirada de columna legacy: solo si no hay dependencias declaradas.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'contenedores'
      AND column_name = 'logistics_destination_type'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_depend d
    JOIN pg_class c ON c.oid = d.objid
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
    WHERE d.refobjid = 'public.contenedores'::regclass
      AND a.attname = 'logistics_destination_type'
      AND c.relkind IN ('v', 'm')
  ) THEN
    ALTER TABLE public.contenedores
      DROP COLUMN logistics_destination_type;
  END IF;
END $$;

-- Retirada de tabla legacy: solo si existe y no tiene dependencias declaradas.
DO $$
BEGIN
  IF to_regclass('public.puerto_pais') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM pg_depend d
    WHERE d.refobjid = 'public.puerto_pais'::regclass
      AND d.deptype <> 'i'
  ) THEN
    DROP TABLE public.puerto_pais;
  END IF;
END $$;
