-- ─────────────────────────────────────────────────────────────────────────────
-- FASE 3: Aplicación de stock al entregar un contenedor
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Reglas (pactadas):
--   · propio                 → stock a ES / canal FBM
--   · agl + puerto UK        → stock a UK / canal FBM  (inventario independiente)
--   · agl + puerto no-UK     → si hay amazon_envios ligados → reparte por país FBA
--                              si no → stock al país del puerto / canal FBA
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Tabla de distribución aplicada (idempotencia + trazabilidad + reversión)
CREATE TABLE IF NOT EXISTS public.contenedor_stock_aplicado (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contenedor_id       uuid        NOT NULL REFERENCES public.contenedores(id) ON DELETE CASCADE,
  orden_item_id       uuid        NULL REFERENCES public.orden_items(id)    ON DELETE SET NULL,
  producto_id         uuid        NOT NULL REFERENCES public.productos(id),
  pais                text        NOT NULL,
  canal               text        NOT NULL,      -- 'FBA' | 'FBM'
  cantidad            int         NOT NULL,
  fuente              text        NOT NULL,      -- 'puerto_default' | 'amazon_csv' | 'manual'
  amazon_shipment_id  text        NULL,
  aplicado_at         timestamptz NOT NULL DEFAULT now(),
  aplicado_by         uuid        NULL REFERENCES auth.users(id),
  revertido_at        timestamptz NULL,
  revertido_by        uuid        NULL REFERENCES auth.users(id),
  notas               text        NULL
);

CREATE INDEX IF NOT EXISTS idx_cont_stock_aplic_contenedor
  ON public.contenedor_stock_aplicado(contenedor_id) WHERE revertido_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cont_stock_aplic_producto
  ON public.contenedor_stock_aplicado(producto_id);

COMMENT ON TABLE public.contenedor_stock_aplicado IS
  'Histórico de incrementos de stock aplicados al entregar un contenedor. Permite revertir y evitar duplicados.';

-- 2) Asegurar unique key (producto_id, pais) en inventario_paises (para upsert atómico)
--    Ya debería existir: si no, crearla.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventario_paises_producto_pais_key'
  ) THEN
    BEGIN
      ALTER TABLE public.inventario_paises
        ADD CONSTRAINT inventario_paises_producto_pais_key
        UNIQUE (producto_id, pais);
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- 3) RPC atómica: suma stock (FBA o FBM) a (producto, pais)
--    Crea la fila si no existe, la incrementa si existe.
CREATE OR REPLACE FUNCTION public.fn_stock_add(
  p_producto_id uuid,
  p_pais        text,
  p_canal       text,   -- 'FBA' | 'FBM'
  p_cantidad    int
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_canal = 'FBA' THEN
    INSERT INTO public.inventario_paises (producto_id, pais, stock_fba, stock_fbm, updated_at)
    VALUES (p_producto_id, p_pais, GREATEST(p_cantidad, 0), 0, now())
    ON CONFLICT (producto_id, pais)
    DO UPDATE SET
      stock_fba  = COALESCE(public.inventario_paises.stock_fba, 0) + EXCLUDED.stock_fba,
      updated_at = now();
  ELSIF p_canal = 'FBM' THEN
    INSERT INTO public.inventario_paises (producto_id, pais, stock_fba, stock_fbm, updated_at)
    VALUES (p_producto_id, p_pais, 0, GREATEST(p_cantidad, 0), now())
    ON CONFLICT (producto_id, pais)
    DO UPDATE SET
      stock_fbm  = COALESCE(public.inventario_paises.stock_fbm, 0) + EXCLUDED.stock_fbm,
      updated_at = now();
  ELSE
    RAISE EXCEPTION 'Canal inválido: %. Usa FBA o FBM', p_canal;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_stock_add IS
  'Incrementa (no reemplaza) el stock de un producto en un país, canal FBA o FBM';

GRANT EXECUTE ON FUNCTION public.fn_stock_add TO authenticated;

-- 4) Tabla opcional de mapping puerto → país (por si luego lo quieres gestionar en BD)
--    Por ahora el mapping se hace en código para ir rápido.
CREATE TABLE IF NOT EXISTS public.puerto_pais (
  puerto  text PRIMARY KEY,
  pais    text NOT NULL
);

INSERT INTO public.puerto_pais(puerto, pais) VALUES
  ('Valencia','ES'),('Barcelona','ES'),('Bilbao','ES'),('Algeciras','ES'),('Vigo','ES'),('Madrid','ES'),
  ('Lisboa','PT'),('Leixões','PT'),
  ('Le Havre','FR'),('Marsella','FR'),('Dunkerque','FR'),
  ('Génova','IT'),('Livorno','IT'),('La Spezia','IT'),
  ('Hamburg','DE'),('Hamburgo','DE'),('Bremerhaven','DE'),
  ('Rotterdam','NL'),('Amsterdam','NL'),
  ('Amberes','BE'),('Antwerp','BE'),
  ('Felixstowe','UK'),('Southampton','UK'),('London Gateway','UK'),('Liverpool','UK'),('Reino Unido','UK')
ON CONFLICT (puerto) DO NOTHING;
