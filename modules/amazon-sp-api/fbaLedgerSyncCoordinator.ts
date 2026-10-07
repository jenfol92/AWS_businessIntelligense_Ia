import { terminalLedger, ledgerEnabled, ledgerRetryAt, type LedgerState, type LedgerReceipt } from "./fbaLedgerSyncPolicy.ts";

export type LedgerJob = { id: string; state: LedgerState };
export type LedgerOptions = { jobId?: string; date?: string; enqueueOnly?: boolean; recoveryOnly?: boolean };
export type LedgerDependencies = {
  now(): number; find(options: LedgerOptions): Promise<LedgerJob | null>;
  acquire(job: LedgerJob): Promise<LedgerJob | null>; save(job: LedgerJob, release?: boolean): Promise<void>;
  create(job: LedgerJob): Promise<string>;
  poll(job: LedgerJob): Promise<{ status: string; documentId?: string; createdAt?: string }>;
  publish(job: LedgerJob, checkpoint: () => Promise<void>): Promise<LedgerReceipt>;
  reconcile(job: LedgerJob): Promise<LedgerReceipt | null>;
  errorInfo(error: unknown): { code: string; temporary: boolean; rateLimited: boolean; retryAfter?: string | null };
};
/** Deliberately small public DTO. Never expose raw, identifiers/URLs from Amazon, or documents. */
export function ledgerResult(job: LedgerJob, busy = false) {
  const s = job.state;
  return { jobId:job.id,ok:s.status === "COMPLETED",status:s.status,phase:s.phase,date:s.date,
    nextAttemptAt:s.nextAttemptAt,error:s.error,busy,rows:s.receipt?.rows ?? 0,
    publishedAt:s.receipt?.publishedAt ?? null,coverageValid:s.manifest?.coverageValid ?? false,
    warnings:s.manifest?.warnings ?? [] };
}
/** Enqueue from HTTP; one bounded phase per recovery invocation. */
export async function coordinateLedgerSync(options: LedgerOptions = {}, supplied?: LedgerDependencies) {
  if (!supplied && !ledgerEnabled()) throw new Error("LEDGER_DISABLED");
  const deps = supplied ?? await (await import("./fbaLedgerSyncRuntime.ts")).ledgerDependencies();
  const found = await deps.find(options);
  if (!found) return null;
  if (options.enqueueOnly || terminalLedger(found.state.status) ||
      (found.state.nextAttemptAt && Date.parse(found.state.nextAttemptAt)>deps.now())) return ledgerResult(found);
  const job = await deps.acquire(found);
  if (!job) return ledgerResult(found,true);
  const s = job.state;
  let creating = false, published = false;
  try {
    if (s.phase === "CREATE" && s.createIntentAt && !s.reportId) {
      s.status="CREATE_UNCERTAIN";s.error="LEDGER_CREATE_OUTCOME_UNKNOWN";
    } else {
      s.attempts++;s.error=null;s.nextAttemptAt=null;
      if (s.phase === "CREATE") {
        s.createIntentAt=new Date(deps.now()).toISOString();
        await deps.save(job);
        creating=true;
        s.reportId=await deps.create(job);
        s.phase="POLL";s.status="PENDING";s.attempts=0;
        s.nextAttemptAt=new Date(deps.now()+15000).toISOString();
      } else if (s.phase === "POLL") {
        const report=await deps.poll(job);
        if (report.status === "DONE") {
          if (!report.documentId || !report.createdAt) throw new Error("LEDGER_INVALID_REPORT_METADATA");
          s.documentId=report.documentId;s.reportCreatedAt=report.createdAt;s.phase="PUBLISH";s.status="PROCESSING";s.attempts=0;
        } else if (report.status === "CANCELLED" || report.status === "FATAL") {
          s.status=report.status;s.error=`LEDGER_AMAZON_${report.status}`;
        } else if (["IN_QUEUE","IN_PROGRESS"].includes(report.status)) {
          s.status="PROCESSING";s.nextAttemptAt=ledgerRetryAt(deps.now(),s.attempts);
        } else throw new Error("LEDGER_INVALID_REPORT_STATUS");
      } else {
        const receipt=await deps.reconcile(job) ?? await deps.publish(job,()=>deps.save(job));
        s.receipt=receipt;s.status="COMPLETED";published=true;
        if (s.manifest) s.manifest.publishedAt=receipt.publishedAt;
        // RPC owns the terminal revision and releases lease atomically. Never overwrite it.
      }
    }
    if (!published) await deps.save(job,true);
  } catch (error) {
    // First reconcile a possibly committed publication, before changing persisted state.
    if (s.phase === "PUBLISH") {
      const receipt=await deps.reconcile(job).catch(()=>null);
      if (receipt) { s.receipt=receipt;s.status="COMPLETED";return ledgerResult(job); }
    }
    const info=deps.errorInfo(error);
    s.error=info.code;
    if (creating && !s.reportId && !info.rateLimited) { s.status="CREATE_UNCERTAIN";s.error="LEDGER_CREATE_OUTCOME_UNKNOWN"; }
    else if ((info.temporary || info.rateLimited) && s.attempts < 10) {
      if (creating && !s.reportId) s.createIntentAt=null;
      s.status=info.rateLimited?"RATE_LIMITED":"PENDING";s.nextAttemptAt=ledgerRetryAt(deps.now(),s.attempts,info.retryAfter);
    } else s.status="FAILED";
    await deps.save(job,true); // CAS fences a stale worker; propagate loss of ownership.
  }
  return ledgerResult(job);
}
