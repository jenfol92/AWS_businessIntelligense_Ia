import { fbmRetryAt, terminalFbmStatus, type FbmState } from "./fbmSyncPolicy.ts";

export type FbmJob = { id: string; state: FbmState };
export type FbmSyncOptions = { jobId?: string; recoveryOnly?: boolean; retryAfterJobId?: string };
export type FbmResult = {
  ok: boolean; status: FbmState["status"]; phase: FbmState["phase"];
  jobId: string | null; reportId: string | null; nextAttemptAt: string | null;
  error: string | null; snapshotRunId: string | null; rowsCommitted: number; busy?: boolean;
};
export type FbmCoordinatorDependencies = {
  now(): number;
  findOrCreate(options: FbmSyncOptions): Promise<FbmJob | null>;
  acquire(job: FbmJob): Promise<FbmJob | null>;
  save(job: FbmJob): Promise<void>;
  release(job: FbmJob): Promise<void>;
  prepare(): Promise<string>;
  create(): Promise<string>;
  poll(reportId: string): Promise<{ processingStatus: string; documentId?: string; observedAt?: string }>;
  publish(job: FbmJob, checkpoint: () => Promise<void>): Promise<number>;
  errorInfo(error: unknown): { rateLimited: boolean; temporary: boolean; retryAfter?: string | null; code: string };
};
export function fbmJobResult(job: FbmJob, busy = false): FbmResult {
  const s = job.state;
  return { ok: s.status === "COMPLETED", status: s.status, phase: s.phase, jobId: job.id,
    reportId: s.reportId, nextAttemptAt: s.nextAttemptAt, error: s.error,
    snapshotRunId: s.status === "COMPLETED" ? s.publication?.runId ?? null : null,
    rowsCommitted: s.status === "COMPLETED" ? s.publication?.rows ?? 0 : 0, ...(busy ? { busy } : {}) };
}
const result = fbmJobResult;

/** Exactly one phase per invocation. No timers or in-memory ownership. */
export async function coordinateFbmSync(
  options: FbmSyncOptions = {},
  supplied?: FbmCoordinatorDependencies,
): Promise<FbmResult | null> {
  const deps = supplied ?? await (await import("./fbmSyncRuntime.ts")).createFbmSyncDependencies();
  const found = await deps.findOrCreate(options);
  if (!found) return null;
  if (terminalFbmStatus(found.state.status) || found.state.status === "CREATE_UNCERTAIN") return result(found);
  if (found.state.nextAttemptAt && Date.parse(found.state.nextAttemptAt) > deps.now()) return result(found);
  const job = await deps.acquire(found);
  if (!job) return result(found, true);
  const s = job.state;
  let creating = false;
  try {
    // A crash after persisted intent may have reached Amazon. Never recreate blindly.
    if (s.phase === "CREATE" && s.createIntentAt && !s.reportId) {
      s.status = "CREATE_UNCERTAIN"; s.error = "CREATE_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED";
      await deps.save(job); return result(job);
    }
    s.attempts++; s.error = null; s.nextAttemptAt = null;
    if (s.phase === "CREATE") {
      s.identityKey = await deps.prepare();
      s.createIntentAt = new Date(deps.now()).toISOString();
      await deps.save(job);
      creating = true;
      s.reportId = await deps.create();
      s.phase = "POLL"; s.status = "PENDING"; s.attempts = 0;
      s.nextAttemptAt = new Date(deps.now() + 15_000).toISOString();
      await deps.save(job); // reportId is durable before returning control.
    } else if (s.phase === "POLL") {
      const report = await deps.poll(s.reportId!);
      s.processingStatus = report.processingStatus;
      switch (report.processingStatus) {
        case "IN_QUEUE": case "IN_PROGRESS":
          s.status = "PROCESSING"; s.nextAttemptAt = fbmRetryAt(deps.now(), s.attempts); break;
        case "DONE":
          if (!report.documentId || !report.observedAt) throw new Error("FBM_INVALID_REPORT_METADATA");
          s.documentId = report.documentId; s.observedAt = report.observedAt;
          s.phase = "PUBLISH"; s.status = "PROCESSING"; s.attempts = 0; break;
        case "CANCELLED": case "FATAL":
          s.status = report.processingStatus; s.error = `AMAZON_REPORT_${report.processingStatus}`; break;
        default: throw new Error("FBM_INVALID_REPORT_STATUS");
      }
      await deps.save(job);
    } else {
      await deps.publish(job, () => deps.save(job));
      s.status = "COMPLETED"; s.completedAt = new Date(deps.now()).toISOString();
      await deps.save(job);
    }
  } catch (error) {
    const info = deps.errorInfo(error);
    s.error = info.code;
    if (creating && !s.reportId && !info.rateLimited) {
      s.status = "CREATE_UNCERTAIN"; s.error = "CREATE_OUTCOME_UNKNOWN_RECONCILIATION_REQUIRED";
    } else if (info.rateLimited || info.temporary) {
      if (creating && info.rateLimited && !s.reportId) s.createIntentAt = null;
      s.status = info.rateLimited ? "RATE_LIMITED" : "PENDING";
      s.nextAttemptAt = fbmRetryAt(deps.now(), s.attempts, info.retryAfter);
    } else {
      s.status = "FAILED";
    }
    await deps.save(job);
  } finally {
    await deps.release(job);
  }
  return result(job);
}
