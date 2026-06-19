-- Staging RAW: Amazon All Orders Report (importación manual .txt/.csv).

CREATE TABLE IF NOT EXISTS public.amazon_all_orders_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  producto_id uuid NULL REFERENCES public.productos(id) ON DELETE SET NULL,

  amazon_order_id text NOT NULL DEFAULT '',
  merchant_order_id text NOT NULL DEFAULT '',
  order_item_id text NOT NULL DEFAULT '',

  purchase_datetime timestamptz NOT NULL,
  purchase_date date NOT NULL,
  last_updated_datetime timestamptz NULL,

  order_status text NOT NULL DEFAULT '',
  item_status text NOT NULL DEFAULT '',

  fulfillment_channel text NOT NULL DEFAULT '',
  sales_channel text NOT NULL DEFAULT '',

  marketplace_country text NOT NULL DEFAULT 'UNKNOWN',
  ship_country text NOT NULL DEFAULT '',

  sku_original text NOT NULL DEFAULT '',
  sku_limpio text NOT NULL,
  asin text NOT NULL DEFAULT '',
  product_name text NULL,

  quantity integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',

  item_price numeric NOT NULL DEFAULT 0,
  item_tax numeric NOT NULL DEFAULT 0,
  shipping_price numeric NOT NULL DEFAULT 0,
  shipping_tax numeric NOT NULL DEFAULT 0,
  gift_wrap_price numeric NOT NULL DEFAULT 0,
  gift_wrap_tax numeric NOT NULL DEFAULT 0,
  item_promotion_discount numeric NOT NULL DEFAULT 0,
  ship_promotion_discount numeric NOT NULL DEFAULT 0,

  is_business_order boolean NOT NULL DEFAULT false,

  canal_venta text NOT NULL DEFAULT 'AMAZON_FBA',

  row_fingerprint text NOT NULL,

  source text NOT NULL DEFAULT 'amazon_all_orders_manual',
  source_file_name text NULL,
  raw jsonb NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT amazon_all_orders_items_row_fingerprint_key UNIQUE (row_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_amz_all_orders_producto_purchase_date
  ON public.amazon_all_orders_items (producto_id, purchase_date);

CREATE INDEX IF NOT EXISTS idx_amz_all_orders_sku_purchase_date
  ON public.amazon_all_orders_items (sku_limpio, purchase_date);

CREATE INDEX IF NOT EXISTS idx_amz_all_orders_purchase_date
  ON public.amazon_all_orders_items (purchase_date);

CREATE INDEX IF NOT EXISTS idx_amz_all_orders_marketplace_country
  ON public.amazon_all_orders_items (marketplace_country);

CREATE INDEX IF NOT EXISTS idx_amz_all_orders_canal_venta
  ON public.amazon_all_orders_items (canal_venta);

COMMENT ON TABLE public.amazon_all_orders_items IS
  'Líneas RAW del informe Amazon All Orders. Agregación a ventas_diarias vía importador.';
