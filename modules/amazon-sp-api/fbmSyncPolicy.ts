import type { FbmIdentityDiagnostics } from "./fbmIdentityReconciliation";

export const FBM_JOB_OWNER = "fbm_reports_coordinator_v1";
export const FBM_JOB_SCOPE = "EU:OWN_ES:FBM:A1RKKUPIHCS9HS";
export const FBM_LEASE_MS = 120_000;
export const FBM_STEP_MS = 45_000;
export const FBM_REFRESH_MS = 5 * 60_000;

export type FbmPhase = "CREATE" | "POLL" | "PUBLISH";
export type FbmStatus = "PENDING" | "PROCESSING" | "RATE_LIMITED" | "COMPLETED" | "CANCELLED" | "FATAL" | "FAILED" | "CREATE_UNCERTAIN";
export type FbmState = {
  version: 1; scope: typeof FBM_JOB_SCOPE; revision: number;
  phase: FbmPhase; status: FbmStatus; attempts: number;
  nextAttemptAt: string | null; error: string | null;
  reportId: string | null; documentId: string | null; processingStatus: string | null;
  createIntentAt: string | null; identityKey: string | null;
  observedAt: string | null; completedAt: string | null;
  lease: { token: string; expiresAt: string } | null;
  publication: { runId: string; rows: number; digest: string } | null;
  identityReconciliation?: FbmIdentityDiagnostics;
};
export function initialFbmState(): FbmState {
  return { version: 1, scope: FBM_JOB_SCOPE, revision: 0, phase: "CREATE", status: "PENDING", attempts: 0,
    nextAttemptAt: null, error: null, reportId: null, documentId: null, processingStatus: null,
    createIntentAt: null, identityKey: null, observedAt: null, completedAt: null, lease: null, publication: null };
}
export const terminalFbmStatus = (status: FbmStatus) => ["COMPLETED", "CANCELLED", "FATAL", "FAILED"].includes(status);
export function fbmHttpStatus(status: string): number {
  if (status === "COMPLETED" || status === "SUCCESS") return 200;
  if (["PENDING", "PROCESSING", "RATE_LIMITED"].includes(status)) return 202;
  if (status === "CREATE_UNCERTAIN") return 409;
  return 422;
}
export function fbmRetryAt(now: number, attempts: number, retryAfter?: string | null): string {
  const seconds = Number(retryAfter);
  const explicit = retryAfter ? (Number.isFinite(seconds) ? now + Math.max(0, seconds) * 1000 : Date.parse(retryAfter)) : NaN;
  return new Date(Math.max(now + Math.min(15 * 60_000, 15_000 * 2 ** Math.min(attempts, 6)), Number.isFinite(explicit) ? explicit : 0)).toISOString();
}
export function fbmManualEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AMAZON_FBM_MANUAL_SYNC_ENABLED === "true" || (env.NODE_ENV !== "production" && env.AMAZON_FBM_MANUAL_SYNC_ENABLED !== "false");
}
export function fbmRecoveryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return fbmManualEnabled(env) || env.AMAZON_FBM_REPORTS_SYNC_ENABLED === "true";
}
