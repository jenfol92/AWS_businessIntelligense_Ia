-- Base trazable SP-API para forecast anual FBA.
-- No actualiza inventario_paises ni stock manual.

CREATE TABLE IF NOT EXISTS public.amazon_fba_sales_daily_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id text NOT NULL,
  marketplace_id text NOT NULL DEFAULT '',
  sale_date date NOT NULL,
  sku_original text NOT NULL DEFAULT '',
  sku_limpio text NOT NULL DEFAULT '',
  producto_id uuid NULL REFERENCES public.productos(id) ON DELETE SET NULL,
  quantity integer NOT NULL DEFAULT 0,
  amount numeric NULL,
  currency text NULL,
  ship_to_country text NULL,
  fulfillment_channel text NOT NULL DEFAULT 'FBA',
  sales_channel text NULL,
  row_fingerprint text NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amazon_fba_sales_daily_raw_row_fingerprint_key UNIQUE (row_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_amz_fba_sales_raw_product_date
  ON public.amazon_fba_sales_daily_raw (producto_id, sale_date);

CREATE INDEX IF NOT EXISTS idx_amz_fba_sales_raw_sku_date
  ON public.amazon_fba_sales_daily_raw (sku_limpio, sale_date);

CREATE INDEX IF NOT EXISTS idx_amz_fba_sales_raw_marketplace_date
  ON public.amazon_fba_sales_daily_raw (marketplace_id, sale_date);

CREATE TABLE IF NOT EXISTS public.amazon_fba_inventory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_at timestamptz NOT NULL,
  marketplace_id text NOT NULL DEFAULT '',
  country text NULL,
  sku_original text NOT NULL DEFAULT '',
  sku_limpio text NOT NULL DEFAULT '',
  producto_id uuid NULL REFERENCES public.productos(id) ON DELETE SET NULL,
  fulfillable_quantity integer NOT NULL DEFAULT 0,
  reserved_quantity integer NULL,
  inbound_quantity integer NULL,
  unfulfillable_quantity integer NULL,
  researching_quantity integer NULL,
  source text NOT NULL,
  row_fingerprint text NOT NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amazon_fba_inventory_snapshots_row_fingerprint_key UNIQUE (row_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_amz_fba_inventory_snapshots_product_at
  ON public.amazon_fba_inventory_snapshots (producto_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_amz_fba_inventory_snapshots_sku_at
  ON public.amazon_fba_inventory_snapshots (sku_limpio, snapshot_at DESC);

CREATE OR REPLACE VIEW public.v_amazon_fba_sales_daily AS
SELECT
  producto_id,
  sale_date AS fecha,
  COALESCE(NULLIF(ship_to_country, ''), 'UNKNOWN') AS pais,
  'FBA'::text AS canal_venta,
  COALESCE(NULLIF(currency, ''), 'EUR') AS moneda,
  marketplace_id,
  SUM(COALESCE(quantity, 0))::integer AS unidades_vendidas,
  SUM(COALESCE(amount, 0))::numeric AS ingresos_brutos
FROM public.amazon_fba_sales_daily_raw
WHERE producto_id IS NOT NULL
GROUP BY
  producto_id,
  sale_date,
  COALESCE(NULLIF(ship_to_country, ''), 'UNKNOWN'),
  COALESCE(NULLIF(currency, ''), 'EUR'),
  marketplace_id;

CREATE OR REPLACE VIEW public.v_latest_amazon_fba_inventory_snapshot AS
WITH ranked AS (
  SELECT
    s.*,
    row_number() OVER (
      PARTITION BY COALESCE(s.producto_id::text, ''), s.sku_limpio, s.marketplace_id, COALESCE(s.country, '')
      ORDER BY s.snapshot_at DESC, s.imported_at DESC
    ) AS rn
  FROM public.amazon_fba_inventory_snapshots s
)
SELECT
  producto_id,
  sku_original,
  sku_limpio,
  marketplace_id,
  country,
  snapshot_at,
  fulfillable_quantity,
  reserved_quantity,
  inbound_quantity,
  unfulfillable_quantity,
  researching_quantity,
  source,
  raw,
  imported_at
FROM ranked
WHERE rn = 1;

COMMENT ON TABLE public.amazon_fba_sales_daily_raw IS
  'Ventas FBA diarias raw desde SP-API GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA. No inventa ventas.';

COMMENT ON TABLE public.amazon_fba_inventory_snapshots IS
  'Snapshots de stock operativo FBA desde SP-API FBA Inventory API/MYI. No actualiza inventario_paises.';

COMMENT ON VIEW public.v_latest_amazon_fba_inventory_snapshot IS
  'Último snapshot FBA operativo por producto/SKU/marketplace/país.';
