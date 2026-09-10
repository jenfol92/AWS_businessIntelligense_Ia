-- PROPOSAL ONLY. Not applied. Scope: FBM run metadata only.
-- Additive schema phase; applying this alone will NOT populate report metadata.
-- No backfill: historical runs retain NULL, including the validated existing run.
-- No changes to snapshots, latest view, timestamps, existing RPCs or shared code.
-- IF NOT EXISTS supports repetition on the expected schema; a future deployment
-- must verify existing same-name columns/index definitions before applying.

BEGIN;

ALTER TABLE public.amazon_fbm_inventory_snapshot_runs
  ADD COLUMN IF NOT EXISTS source_report_id text,
  ADD COLUMN IF NOT EXISTS source_report_type text;

-- Non-unique: permits multiple audited runs from the same source document.
-- This is lookup support, not a deduplication/idempotency business rule.
-- Partial index excludes historical rows with unknown provenance.
CREATE INDEX IF NOT EXISTS idx_amazon_fbm_runs_source_report_marketplace
  ON public.amazon_fbm_inventory_snapshot_runs (source_report_id, marketplace_id)
  WHERE source_report_id IS NOT NULL;

COMMIT;

-- FUTURE CODE/RPC DESIGN ONLY (not implemented by this proposal):
-- 1. syncAmazonFbmInventoryFromReports passes validated report.reportId and
--    report.reportType to commitCompleteFbmReportSnapshot as run-level metadata.
-- 2. Extend commit payload with required p_source_report_id / p_source_report_type.
-- 3. Add a nine-argument overload of commit_amazon_fbm_inventory_snapshot_run:
--    existing seven arguments plus two required text arguments, WITHOUT defaults.
--    Preserve the seven-argument API for existing callers; avoid ambiguous defaults.
--    The overload validates nonempty ID, exact supported report type and ES scope,
--    calls the existing seven-argument canonical commit, then attaches metadata
--    only to p_run_id in the SAME database transaction. Failure rolls back both.
--    Preserve return integer, permissions, invoker security and search_path;
--    audit PostgREST dispatch and grants before any implementation/deployment.
--    No client-side second write, retry, upsert or historical overwrite.
-- 4. For the new Reports overload, completed_at may be stamped with
--    clock_timestamp() at the end of successful RPC work. This is a pre-COMMIT
--    completion marker, NOT an exact PostgreSQL transaction commit timestamp.
--    Legacy completed_at remains its original now() transaction-start value.
-- 5. observed_at remains report.createdTime, propagated unchanged to every row.
--    createdTime is report creation time, not a per-item last-stock-change time.
--    Keep latest selection observed_at DESC, completed_at DESC for this phase.
--    Equal values for both timestamps currently leave an unresolved tie; a future
--    isolated FBM review can add id as a deterministic final key if required.
-- 6. No source_marketplace_id / operational_pool / fulfillment duplication:
--    marketplace_id already identifies report scope; current Reports contract
--    fixes OWN_ES / FBM. No unique report constraint until replay policy is defined.
-- 7. Future tests: round-trip provenance, NULL legacy compatibility, invalid/pair
--    metadata rejection before writes, overload dispatch, metadata failure rollback,
--    unchanged observed_at, delayed older report ordering, duplicate report lookup,
--    unchanged stock/identity/auth/timeouts and isolated FBM timestamp presentation.
-- 8. An isolated authenticated FBM read endpoint/component should return the same
--    selected run's id, observed_at, completed_at and provenance. Do not substitute
--    generic inventory health timestamps. Shared inventory UI remains audit-only.
