import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/server/supabase/adminClient";
import { loadSpApiConfig } from "./config";
import { createReport, getReport, getReportDocument, downloadReportDocument } from "./reportsClient";
import { safeSpApiErrorMetadata } from "./errors";
import { loadCanonicalFbmProductIdentities, loadFbmIdentityProducts } from "./fbmProductIdentityRepository";
import { fbmIdentityKey as identityKey, reconcileFbmIdentities } from "./fbmIdentityReconciliation";
import { FBM_REPORT_TYPE, FBM_REPORT_MARKETPLACE, FBM_REPORT_LIMITS, parseFbmListingsReport, normalizeFbmReportSnapshot, FbmReportEvidenceError } from "./fbmReportsSnapshot";
import { commitCompleteFbmReportSnapshot } from "./fbmReportsCommit";
import { FBM_STEP_MS } from "./fbmSyncPolicy";
import { findOrCreateFbmJob, acquireFbmJob, saveFbmJob } from "./fbmSyncRepository";
import type { FbmCoordinatorDependencies, FbmJob } from "./fbmSyncCoordinator";

type Row = { producto_id: string; seller_sku: string; sku_limpio: string; asin: string | null; marketplace_id: string; available_quantity: number; observed_at: string };
function digest(rows: Row[]): string {
  return createHash("sha256").update(JSON.stringify(rows.map(r => [r.producto_id, r.seller_sku, r.sku_limpio, r.asin,
    r.marketplace_id, r.available_quantity, new Date(r.observed_at).toISOString()]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))))).digest("hex");
}

async function confirmedPublication(job: FbmJob, signal: AbortSignal): Promise<number | null> {
  const publication = job.state.publication;
  if (!publication) return null;
  const { data: run, error } = await supabaseAdmin.from("amazon_fbm_inventory_snapshot_runs")
    .select("id,observed_at,marketplace_id,status,publication_ready,canonical_row_count,expected_identity_count,completed_identity_count")
    .eq("id", publication.runId).abortSignal(signal).maybeSingle();
  if (error) throw new Error("FBM_PUBLICATION_READ_FAILED");
  if (!run) return null;
  if (run.status !== "COMPLETE" || !run.publication_ready || run.marketplace_id !== FBM_REPORT_MARKETPLACE ||
    new Date(run.observed_at).toISOString() !== job.state.observedAt || run.canonical_row_count !== publication.rows ||
    run.expected_identity_count !== publication.rows || run.completed_identity_count !== publication.rows) throw new Error("FBM_PUBLICATION_MISMATCH");
  const rows: Row[] = [];
  for (let offset = 0; offset <= publication.rows; offset += 500) {
    const { data, error: rowsError } = await supabaseAdmin.from("amazon_fbm_inventory_snapshots")
      .select("producto_id,seller_sku,sku_limpio,asin,marketplace_id,available_quantity,observed_at")
      .eq("snapshot_run_id", publication.runId).order("producto_id").range(offset, offset + 499).abortSignal(signal);
    if (rowsError) throw new Error("FBM_PUBLICATION_READ_FAILED");
    rows.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  if (rows.length !== publication.rows || digest(rows) !== publication.digest) throw new Error("FBM_PUBLICATION_MISMATCH");
  return rows.length;
}

export async function createFbmSyncDependencies(): Promise<FbmCoordinatorDependencies> {
  const signal = AbortSignal.timeout(FBM_STEP_MS);
  const options = () => ({ signal: AbortSignal.any([signal, AbortSignal.timeout(FBM_REPORT_LIMITS.requestMs)]), retryExpiredAccessToken: false, rateLimitRetry: { maxRetries: 0 } });
  function safeIdentifier(value: unknown): value is string {
    if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,500}$/.test(value)) return false;
    const config = loadSpApiConfig();
    const secrets = [config.sellerId, config.lwaClientId, config.lwaClientSecret, config.lwaRefreshToken,
      config.awsAccessKeyId, config.awsSecretAccessKey, config.awsRoleArn].filter(Boolean);
    return !secrets.some(secret => value.includes(secret));
  }
  return {
    now: Date.now, findOrCreate: findOrCreateFbmJob, acquire: acquireFbmJob,
    save: job => saveFbmJob(job), release: job => saveFbmJob(job, true),
    async prepare() {
      const config = loadSpApiConfig();
      if (config.region !== "EU" || config.endpoint !== "https://sellingpartnerapi-eu.amazon.com" || config.useAwsSigV4) throw new Error("FBM_UNSUPPORTED_CONFIG");
      return identityKey(await loadCanonicalFbmProductIdentities(signal));
    },
    async create() {
      const created = await createReport({ reportType: FBM_REPORT_TYPE, marketplaceIds: [FBM_REPORT_MARKETPLACE] }, options());
      if (!safeIdentifier(created.reportId)) throw new Error("FBM_INVALID_REPORT_ID");
      return created.reportId;
    },
    async poll(reportId) {
      const report = await getReport(reportId, options());
      if (report.reportId !== reportId || report.reportType !== FBM_REPORT_TYPE || report.marketplaceIds?.join() !== FBM_REPORT_MARKETPLACE) throw new Error("FBM_REPORT_SCOPE_MISMATCH");
      if (report.processingStatus === "DONE" && !safeIdentifier(report.reportDocumentId)) throw new Error("FBM_INVALID_DOCUMENT_ID");
      if (report.processingStatus === "DONE" && (!report.createdTime || !Number.isFinite(Date.parse(report.createdTime)) || Date.parse(report.createdTime) > Date.now() + 60_000)) throw new Error("FBM_INVALID_REPORT_TIME");
      return { processingStatus: report.processingStatus, documentId: report.reportDocumentId,
        observedAt: report.createdTime ? new Date(report.createdTime).toISOString() : undefined };
    },
    async publish(job, checkpoint) {
      // Reconcile a lost commit response BEFORE revalidation/redownload.
      const confirmed = await confirmedPublication(job, signal);
      if (confirmed !== null) return confirmed;
      const reconcile = async () => {
        const result = reconcileFbmIdentities(job.state.identityKey, await loadFbmIdentityProducts(signal));
        job.state.identityReconciliation = result.diagnostics;
        if (!result.ok) throw new Error("FBM_IDENTITY_UNIVERSE_CHANGED");
        return result.identities;
      };
      await reconcile();
      const document = await getReportDocument(job.state.documentId!, options());
      if (document.reportDocumentId !== job.state.documentId) throw new Error("FBM_DOCUMENT_ID_MISMATCH");
      const text = await downloadReportDocument(document, { signal: options().signal, maxBytes: FBM_REPORT_LIMITS.maxBytes });
      const parsed = parseFbmListingsReport(text);
      // Revalidate after downloading; coverage applies to this final operational universe.
      const identities = await reconcile();
      const normalized = normalizeFbmReportSnapshot(parsed, identities, job.state.observedAt!);
      if (normalized.error) throw new FbmReportEvidenceError(normalized.error);
      const publication = { runId: job.id, rows: normalized.rows.length, digest: digest(normalized.rows) };
      if (job.state.publication && JSON.stringify(job.state.publication) !== JSON.stringify(publication)) throw new Error("FBM_PUBLICATION_MISMATCH");
      job.state.publication = publication;
      await checkpoint(); // Stable UUID and payload identity BEFORE the atomic RPC.
      signal.throwIfAborted();
      try {
        await commitCompleteFbmReportSnapshot(job.id, job.state.observedAt!, identities.length, normalized.rows, options().signal);
      } catch {
        // The existing RPC is insert-only. Same run PK prevents double publication.
        const recovered = await confirmedPublication(job, signal);
        if (recovered !== null) return recovered;
        throw new Error("FBM_COMMIT_UNCONFIRMED");
      }
      const verified = await confirmedPublication(job, signal);
      if (verified === null) throw new Error("FBM_COMMIT_UNCONFIRMED");
      return verified;
    },
    errorInfo(error) {
      const info = safeSpApiErrorMetadata(error);
      const message = error instanceof Error ? error.message : "";
      const evidence = error instanceof FbmReportEvidenceError;
      const permanent = evidence || /^FBM_(INVALID_|DUPLICATE_|UNSUPPORTED_|REPORT_SCOPE_|DOCUMENT_ID_|IDENTITY_UNIVERSE_|PUBLICATION_MISMATCH)/.test(message);
      return { rateLimited: info.httpStatus === 429 || info.code === "rate_limited",
        temporary: !permanent && (info.httpStatus == null || info.httpStatus >= 500 || info.httpStatus === 408 || info.httpStatus === 429),
        retryAfter: info.retryAfter, code: evidence ? error.code : permanent ? message : info.httpStatus ? `FBM_UPSTREAM_HTTP_${info.httpStatus}` : "FBM_TEMPORARY_FAILURE" };
    },
  };
}
