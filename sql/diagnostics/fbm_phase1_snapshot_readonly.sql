-- READ ONLY. No migration, DML, or calls to publication functions.
BEGIN TRANSACTION READ ONLY;

-- Durable lifecycle (only the FBM owner). report_id is Amazon's report, id is the local job.
SELECT id AS job_id, source, report_type, report_id, report_document_id,
       status, processing_status, requested_at, completed_at,
       raw->'fbm'->>'phase' AS phase,
       raw->'fbm'->>'nextAttemptAt' AS next_attempt_at,
       raw->'fbm'->>'error' AS error,
       raw->'fbm'->'publication' AS publication
FROM public.amazon_spapi_report_jobs
WHERE source = 'fbm_reports_coordinator_v1'
ORDER BY requested_at DESC, id DESC
LIMIT 10;

-- Last publishable snapshot per marketplace, using observed_at from Amazon report.createdTime.
-- The snapshot tables have no source/job_id/report_id columns: obtain those from the related job.
WITH latest AS (
  SELECT DISTINCT ON (marketplace_id) id, marketplace_id, observed_at, completed_at
  FROM public.amazon_fbm_inventory_snapshot_runs
  WHERE status = 'COMPLETE' AND publication_ready = true
  ORDER BY marketplace_id, observed_at DESC, completed_at DESC
)
SELECT r.id AS snapshot_run_id, j.id AS job_id, j.source, j.report_id,
       s.producto_id, s.seller_sku, s.sku_limpio, s.asin, s.marketplace_id,
       s.available_quantity, s.observed_at, r.completed_at
FROM latest r
JOIN public.amazon_fbm_inventory_snapshots s ON s.snapshot_run_id = r.id
LEFT JOIN public.amazon_spapi_report_jobs j
  ON j.id = r.id AND j.source = 'fbm_reports_coordinator_v1'
ORDER BY s.marketplace_id, s.seller_sku;

SELECT producto_id, marketplace_id, stock_fbm, observed_at, seller_sku_count
FROM public.v_latest_amazon_fbm_inventory_by_product
ORDER BY marketplace_id, producto_id;
ROLLBACK;
