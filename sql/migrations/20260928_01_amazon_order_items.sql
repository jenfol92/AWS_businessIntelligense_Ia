-- Pedidos Amazon por fecha de compra (FBA + FBM, incluidos pendientes), como
-- Shopkeeper / informe de negocio de Amazon.
-- Fuente: SP-API GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL.
-- Tabla nueva y aislada: no modifica ventas_diarias, amazon_fba_sales_daily_raw
-- ni amazon_all_orders_items (manual, usada por finanzas).
-- Sin datos personales: no se guardan ciudad, código postal ni dirección.

BEGIN;

CREATE TABLE IF NOT EXISTS public.amazon_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NULL REFERENCES public.productos(id) ON DELETE SET NULL,

  amazon_order_id text NOT NULL,
  merchant_order_id text NULL,
  seller_sku text NOT NULL,
  asin text NOT NULL DEFAULT '',

  purchase_datetime timestamptz NOT NULL,
  -- Fecha de compra en la hora local del marketplace (ES/FR/DE/IT… Europe/Madrid; GB Europe/London).
  purchase_date date NOT NULL,
  last_updated_datetime timestamptz NULL,

  order_status text NOT NULL DEFAULT '',
  item_status text NOT NULL DEFAULT '',
  -- FBA | FBM
  fulfillment_channel text NOT NULL,
  sales_channel text NULL,
  marketplace_country text NOT NULL DEFAULT 'UNKNOWN',
  ship_country text NULL,

  quantity integer NOT NULL DEFAULT 0,
  currency text NULL,
  item_price numeric NULL,
  item_tax numeric NULL,
  shipping_price numeric NULL,
  item_promotion_discount numeric NULL,
  is_business_order boolean NOT NULL DEFAULT false,

  row_fingerprint text NOT NULL,
  report_id text NULL,
  source text NOT NULL DEFAULT 'spapi_all_orders_by_order_date',
  imported_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT amazon_order_items_fingerprint_key UNIQUE (row_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_amazon_order_items_product_date
  ON public.amazon_order_items (producto_id, purchase_date);
CREATE INDEX IF NOT EXISTS idx_amazon_order_items_date
  ON public.amazon_order_items (purchase_date);
CREATE INDEX IF NOT EXISTS idx_amazon_order_items_sku
  ON public.amazon_order_items (seller_sku);

COMMENT ON TABLE public.amazon_order_items IS
  'Líneas de pedido Amazon por fecha de compra (All Orders by order date, SP-API). FBA+FBM, incluye Pending; Cancelled se excluye al leer.';

-- Solo el servidor (service_role) lee y escribe esta tabla.
ALTER TABLE public.amazon_order_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.amazon_order_items FROM PUBLIC;
REVOKE ALL ON public.amazon_order_items FROM anon;
REVOKE ALL ON public.amazon_order_items FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.amazon_order_items
TO service_role;

COMMIT;
