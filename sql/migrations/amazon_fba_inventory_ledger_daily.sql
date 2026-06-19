-- Histórico diario FBA desde Amazon Inventory Ledger Summary (importación manual CSV).

CREATE TABLE IF NOT EXISTS public.amazon_fba_inventory_ledger_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  producto_id uuid NULL REFERENCES public.productos(id) ON DELETE SET NULL,

  sku_original text NOT NULL DEFAULT '',
  sku_limpio text NOT NULL,
  fnsku text NOT NULL DEFAULT '',
  asin text NOT NULL DEFAULT '',
  title text NULL,

  snapshot_date date NOT NULL,

  disposition text NOT NULL DEFAULT '',

  starting_warehouse_balance integer NOT NULL DEFAULT 0,
  in_transit_between_warehouses integer NOT NULL DEFAULT 0,
  receipts integer NOT NULL DEFAULT 0,
  customer_shipments integer NOT NULL DEFAULT 0,
  customer_returns integer NOT NULL DEFAULT 0,
  vendor_returns integer NOT NULL DEFAULT 0,
  warehouse_transfer_in_out integer NOT NULL DEFAULT 0,
  found integer NOT NULL DEFAULT 0,
  lost integer NOT NULL DEFAULT 0,
  damaged integer NOT NULL DEFAULT 0,
  disposed integer NOT NULL DEFAULT 0,
  other_events integer NOT NULL DEFAULT 0,
  ending_warehouse_balance integer NOT NULL DEFAULT 0,
  unknown_events integer NOT NULL DEFAULT 0,

  location text NOT NULL DEFAULT '',
  location_country text NULL,

  source text NOT NULL DEFAULT 'amazon_fba_ledger_summary_manual',
  source_file_name text NULL,

  raw jsonb NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT amazon_fba_inventory_ledger_daily_unique
    UNIQUE (sku_original, fnsku, asin, snapshot_date, disposition, location, source)
);

CREATE INDEX IF NOT EXISTS idx_amz_fba_ledger_producto_snapshot
  ON public.amazon_fba_inventory_ledger_daily (producto_id, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_amz_fba_ledger_sku_snapshot
  ON public.amazon_fba_inventory_ledger_daily (sku_limpio, snapshot_date);

CREATE INDEX IF NOT EXISTS idx_amz_fba_ledger_asin_snapshot
  ON public.amazon_fba_inventory_ledger_daily (asin, snapshot_date)
  WHERE asin <> '';

CREATE INDEX IF NOT EXISTS idx_amz_fba_ledger_snapshot_date
  ON public.amazon_fba_inventory_ledger_daily (snapshot_date);

CREATE INDEX IF NOT EXISTS idx_amz_fba_ledger_location
  ON public.amazon_fba_inventory_ledger_daily (location)
  WHERE location <> '';

CREATE INDEX IF NOT EXISTS idx_amz_fba_ledger_disposition
  ON public.amazon_fba_inventory_ledger_daily (disposition)
  WHERE disposition <> '';

COMMENT ON TABLE public.amazon_fba_inventory_ledger_daily IS
  'Histórico diario FBA por SKU/disposición/almacén desde Inventory Ledger Summary (CSV manual).';

-- Vista consolidada de stock FBA diario por producto / SKU limpio.
CREATE OR REPLACE VIEW public.v_product_fba_stock_daily AS
SELECT
  l.producto_id,
  l.sku_limpio,
  l.snapshot_date,
  SUM(
    CASE WHEN upper(trim(l.disposition)) = 'SELLABLE'
      THEN COALESCE(l.ending_warehouse_balance, 0)
      ELSE 0
    END
  )::bigint AS stock_sellable,
  SUM(
    CASE WHEN upper(trim(l.disposition)) <> 'SELLABLE'
      THEN COALESCE(l.ending_warehouse_balance, 0)
      ELSE 0
    END
  )::bigint AS stock_unsellable,
  SUM(COALESCE(l.ending_warehouse_balance, 0))::bigint AS stock_total,
  SUM(COALESCE(l.receipts, 0))::bigint AS receipts,
  SUM(COALESCE(l.customer_shipments, 0))::bigint AS customer_shipments,
  SUM(COALESCE(l.customer_returns, 0))::bigint AS customer_returns,
  SUM(COALESCE(l.in_transit_between_warehouses, 0))::bigint AS in_transit_between_warehouses,
  COUNT(DISTINCT NULLIF(trim(l.location), ''))::integer AS locations_count
FROM public.amazon_fba_inventory_ledger_daily l
GROUP BY
  l.producto_id,
  l.sku_limpio,
  l.snapshot_date;

COMMENT ON VIEW public.v_product_fba_stock_daily IS
  'Stock FBA diario consolidado por producto/SKU desde ledger importado. No usar aún en forecast.';
