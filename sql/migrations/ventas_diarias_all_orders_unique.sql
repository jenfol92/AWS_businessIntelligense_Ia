-- Clave única ampliada para upsert seguro desde All Orders (moneda, tipo_cliente, marketplace).

ALTER TABLE public.ventas_diarias
  ADD COLUMN IF NOT EXISTS tipo_cliente text NOT NULL DEFAULT 'B2C';

ALTER TABLE public.ventas_diarias
  ADD COLUMN IF NOT EXISTS marketplace_id text NOT NULL DEFAULT '';

UPDATE public.ventas_diarias
SET moneda = 'EUR'
WHERE moneda IS NULL OR btrim(moneda) = '';

ALTER TABLE public.ventas_diarias
  ALTER COLUMN moneda SET DEFAULT 'EUR';

UPDATE public.ventas_diarias
SET marketplace_id = ''
WHERE marketplace_id IS NULL;

UPDATE public.ventas_diarias
SET tipo_cliente = 'B2C'
WHERE tipo_cliente IS NULL OR btrim(tipo_cliente) = '';

DROP INDEX IF EXISTS public.ventas_diarias_producto_fecha_pais_canal_idx;

CREATE UNIQUE INDEX IF NOT EXISTS ventas_diarias_grain_unique_idx
  ON public.ventas_diarias (
    producto_id,
    fecha,
    pais,
    canal_venta,
    moneda,
    tipo_cliente,
    marketplace_id
  );

COMMENT ON INDEX public.ventas_diarias_grain_unique_idx IS
  'Grano diario para upsert desde All Orders y otras fuentes Amazon.';
