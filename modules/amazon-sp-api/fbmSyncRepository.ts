import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/server/supabase/adminClient";
import { claimReportRequestJob } from "./reportJobsRepository";
import { FBM_REPORT_MARKETPLACE, FBM_REPORT_TYPE } from "./fbmReportsSnapshot";
import { FBM_JOB_OWNER, FBM_JOB_SCOPE, FBM_LEASE_MS, FBM_REFRESH_MS, initialFbmState, type FbmState } from "./fbmSyncPolicy";
import type { FbmJob, FbmSyncOptions } from "./fbmSyncCoordinator";

type StoredJob = { id: string; source: string; report_type: string; marketplace_ids: string[] | null; raw: Record<string, unknown> | null };
function decode(row: StoredJob): FbmJob {
  if (row.source !== FBM_JOB_OWNER || row.report_type !== FBM_REPORT_TYPE || row.marketplace_ids?.join() !== FBM_REPORT_MARKETPLACE) throw new Error("FBM_INVALID_JOB_OWNER");
  const state = row.raw?.fbm as FbmState | undefined;
  if (state && (state.version !== 1 || state.scope !== FBM_JOB_SCOPE)) throw new Error("FBM_INVALID_JOB_SCOPE");
  return { id: row.id, state: state ?? initialFbmState() };
}
const query = () => supabaseAdmin.from("amazon_spapi_report_jobs").select("id,source,report_type,marketplace_ids,raw")
  .eq("source", FBM_JOB_OWNER).eq("report_type", FBM_REPORT_TYPE);

export async function findOrCreateFbmJob(options: FbmSyncOptions): Promise<FbmJob | null> {
  const { data, error } = options.jobId
    ? await query().eq("id", options.jobId).maybeSingle()
    : await query().order("requested_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("FBM_JOB_READ_FAILED");
  if (options.jobId && !data) throw new Error("FBM_JOB_NOT_FOUND");
  const previous = data ? decode(data as StoredJob) : null;
  if (previous) {
    const explicitRetry = options.retryAfterJobId === previous.id && ["CANCELLED", "FATAL", "FAILED"].includes(previous.state.status);
    const freshCompletion = previous.state.status === "COMPLETED" && previous.state.completedAt && Date.now() - Date.parse(previous.state.completedAt) >= FBM_REFRESH_MS;
    if (options.jobId || options.recoveryOnly || (!explicitRetry && !freshCompletion)) return previous;
  } else if (options.recoveryOnly) return null;
  // A stable predecessor + fixed bucket gives concurrent starts the SAME UUID.
  // Failed/uncertain work is retained; only confirmed completion permits a new generation.
  const claimed = await claimReportRequestJob({ reportType: FBM_REPORT_TYPE, marketplaceIds: [FBM_REPORT_MARKETPLACE],
    source: FBM_JOB_OWNER, now: new Date(0), requestKey: { owner: FBM_JOB_OWNER, scope: FBM_JOB_SCOPE, previousJobId: previous?.id ?? null },
    requestedCreateReportPayload: { owner: FBM_JOB_OWNER, scope: FBM_JOB_SCOPE } });
  return decode(claimed.job);
}

/** PostgREST UPDATE predicates are one atomic PostgreSQL compare-and-swap. */
export async function acquireFbmJob(job: FbmJob): Promise<FbmJob | null> {
  const now = Date.now();
  if (job.state.lease && Date.parse(job.state.lease.expiresAt) > now) return null;
  const state: FbmState = { ...job.state, revision: job.state.revision + 1,
    lease: { token: randomUUID(), expiresAt: new Date(now + FBM_LEASE_MS).toISOString() } };
  let update = supabaseAdmin.from("amazon_spapi_report_jobs").update({ raw: { fbm: state }, updated_at: new Date(now).toISOString() })
    .eq("id", job.id).eq("source", FBM_JOB_OWNER).eq("report_type", FBM_REPORT_TYPE);
  update = job.state.revision === 0 ? update.is("raw->fbm", null) : update.eq("raw->fbm->>revision", String(job.state.revision));
  const { data, error } = await update.select("id").maybeSingle();
  if (error) throw new Error("FBM_LEASE_CLAIM_FAILED");
  return data ? { id: job.id, state } : null;
}

export async function saveFbmJob(job: FbmJob, release = false): Promise<void> {
  const previous = job.state;
  if (!previous.lease) throw new Error("FBM_LEASE_LOST");
  const now = new Date().toISOString();
  const next: FbmState = { ...previous, revision: previous.revision + 1, lease: release ? null : previous.lease };
  const { data, error } = await supabaseAdmin.from("amazon_spapi_report_jobs").update({
    raw: { fbm: next }, status: next.status, report_id: next.reportId, report_document_id: next.documentId,
    processing_status: next.processingStatus, error_message: next.error, completed_at: next.completedAt, updated_at: now,
  }).eq("id", job.id).eq("source", FBM_JOB_OWNER).eq("report_type", FBM_REPORT_TYPE)
    .eq("raw->fbm->>revision", String(previous.revision)).eq("raw->fbm->lease->>token", previous.lease.token)
    .gt("raw->fbm->lease->>expiresAt", now).select("id").maybeSingle();
  if (error) throw new Error("FBM_CHECKPOINT_FAILED");
  if (!data) throw new Error("FBM_LEASE_LOST");
  Object.assign(previous, next);
}
