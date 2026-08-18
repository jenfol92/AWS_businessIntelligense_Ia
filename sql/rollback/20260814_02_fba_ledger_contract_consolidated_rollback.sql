-- NOT FOR AUTOMATIC EXECUTION. Structural rollback only.
-- New columns and merged duplicate provenance are deliberately retained so no
-- historical evidence is discarded. Review duplicate_provenance before use.
BEGIN;
DROP VIEW IF EXISTS public.v_latest_fba_inventory_by_product_location;
DROP INDEX IF EXISTS public.idx_amz_fba_ledger_location_raw;
DROP INDEX IF EXISTS public.idx_amz_fba_ledger_physical_country;
DROP INDEX IF EXISTS public.idx_amz_fba_ledger_document_identity;
ALTER TABLE public.amazon_fba_inventory_ledger_daily
  DROP CONSTRAINT IF EXISTS amazon_fba_inventory_ledger_daily_unique,
  DROP CONSTRAINT IF EXISTS amazon_fba_ledger_document_identity_type_check,
  DROP CONSTRAINT IF EXISTS amazon_fba_ledger_location_type_check,
  DROP CONSTRAINT IF EXISTS amazon_fba_ledger_location_confidence_check;
-- Recreate the old constraint only after verifying that aliases merged by the
-- consolidated migration do not produce duplicate old keys.
-- ALTER TABLE ... ADD CONSTRAINT ... UNIQUE
--   (sku_original, fnsku, asin, snapshot_date, disposition, location, source);
COMMIT;
