-- Histórico diario de stock FBA por país/marketplace (importador AFN by country).
-- NO usado en forecast todavía.

CREATE TABLE IF NOT EXISTS public.fba_country_stock_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  sku_limpio text NOT NULL,
  marketplace_country text NOT NULL,
  marketplace_id text NULL,
  snapshot_date date NOT NULL,
  stock_fba integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'amazon_fba_country_report',
  raw jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fba_country_stock_daily_grain_unique
    UNIQUE (producto_id, sku_limpio, marketplace_country, snapshot_date, source)
);

CREATE INDEX IF NOT EXISTS idx_fba_country_stock_daily_producto_date
  ON public.fba_country_stock_daily (producto_id, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_fba_country_stock_daily_country_date
  ON public.fba_country_stock_daily (marketplace_country, snapshot_date DESC);

COMMENT ON TABLE public.fba_country_stock_daily IS
  'Snapshots diarios de stock FBA por país desde informe GET_AFN_INVENTORY_DATA_BY_COUNTRY o equivalente manual.';
