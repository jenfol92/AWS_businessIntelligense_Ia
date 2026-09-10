BEGIN;

CREATE OR REPLACE VIEW public.v_latest_amazon_fba_inventory_snapshot AS
WITH latest_run AS (
  SELECT id
  FROM public.amazon_fba_inventory_snapshot_runs
  WHERE status = 'COMPLETE'
    AND publication_ready = true
    AND identity_conflict_count = 0
    AND complete_operational_pools @> ARRAY['EU', 'UK']::text[]
  ORDER BY observed_at DESC, completed_at DESC
  LIMIT 1
)
SELECT
  s.producto_id, s.sku_original, s.sku_limpio, s.marketplace_id, s.country,
  s.snapshot_at, s.fulfillable_quantity, s.reserved_quantity,
  s.inbound_total_quantity AS inbound_quantity, s.unfulfillable_quantity,
  s.researching_quantity, s.source, s.raw, s.imported_at,
  s.snapshot_run_id, s.observed_at, s.asin, s.fnsku, s.operational_pool,
  s.seller_sku_aliases, s.observed_marketplaces,
  s.pending_customer_order_quantity, s.pending_transshipment_quantity,
  s.fc_processing_quantity, s.inbound_working_quantity,
  s.inbound_shipped_quantity, s.inbound_receiving_quantity,
  s.inbound_total_quantity, s.total_quantity_raw,
  s.amazon_last_updated_time, s.confidence, s.conflict_metadata
FROM public.amazon_fba_inventory_snapshots s
JOIN latest_run r ON r.id = s.snapshot_run_id;

COMMENT ON VIEW public.v_latest_amazon_fba_inventory_snapshot IS
  'Ultimo snapshot FBA atomico listo para publicar, con PAN_EU y UK completos y sin conflictos.';

COMMIT;
