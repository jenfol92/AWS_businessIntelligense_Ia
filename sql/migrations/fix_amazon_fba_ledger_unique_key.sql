-- Corregir clave única del ledger FBA para no colapsar distintos MSKU/FNSKU
-- que comparten el mismo sku_limpio.

ALTER TABLE public.amazon_fba_inventory_ledger_daily
  ALTER COLUMN sku_original SET DEFAULT '';

UPDATE public.amazon_fba_inventory_ledger_daily
SET sku_original = ''
WHERE sku_original IS NULL;

ALTER TABLE public.amazon_fba_inventory_ledger_daily
  ALTER COLUMN sku_original SET NOT NULL;

ALTER TABLE public.amazon_fba_inventory_ledger_daily
  ALTER COLUMN fnsku SET DEFAULT '';

UPDATE public.amazon_fba_inventory_ledger_daily
SET fnsku = ''
WHERE fnsku IS NULL;

ALTER TABLE public.amazon_fba_inventory_ledger_daily
  ALTER COLUMN fnsku SET NOT NULL;

ALTER TABLE public.amazon_fba_inventory_ledger_daily
  DROP CONSTRAINT IF EXISTS amazon_fba_inventory_ledger_daily_unique;

ALTER TABLE public.amazon_fba_inventory_ledger_daily
  ADD CONSTRAINT amazon_fba_inventory_ledger_daily_unique
  UNIQUE (
    sku_original,
    fnsku,
    asin,
    snapshot_date,
    disposition,
    location,
    source
  );

COMMENT ON CONSTRAINT amazon_fba_inventory_ledger_daily_unique
  ON public.amazon_fba_inventory_ledger_daily IS
  'Grano real de Amazon: MSKU original + FNSKU. sku_limpio se agrupa en v_product_fba_stock_daily.';
