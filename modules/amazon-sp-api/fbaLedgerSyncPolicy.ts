import { validLedgerDate, LedgerEvidenceError } from "../imports/amazon-fba-ledger-summary/strictLedgerDocument.ts";
import { lastCompleteFbaLedgerUtcDay } from "./fbaLedgerSchedulePolicy.ts";

export const LEDGER_OWNER = "fba_ledger_coordinator_v1";
export const LEDGER_REPORT_TYPE = "GET_LEDGER_SUMMARY_VIEW_DATA";
export const LEDGER_STEP_MS = 45000;
export const LEDGER_LEASE_MS = 120000;
export type LedgerPhase = "CREATE" | "POLL" | "PUBLISH";
export type LedgerStatus = "PENDING" | "PROCESSING" | "RATE_LIMITED" | "CREATE_UNCERTAIN" | "COMPLETED" | "FAILED" | "CANCELLED" | "FATAL";
export type LedgerManifest = {
  version: 1; reportType: typeof LEDGER_REPORT_TYPE; fromDate: string; toDate: string;
  marketplaceIds: string[]; aggregateByLocation: "COUNTRY"; aggregatedByTimePeriod: "DAILY";
  reportId: string; documentId: string; digest: string; documentDigest: string;
  parsedRows: number; linkedRows: number; unlinkedRows: number; canonicalRows: number;
  unclassifiedLocations: number; unknownConditionRows: number; duplicateRows: number;
  warnings: string[]; errors: string[]; coverageValid: boolean; publishedAt: string | null;
};
export type LedgerReceipt = { jobId: string; documentId: string; digest: string; rows: number; publishedAt: string };
export type LedgerState = {
  version: 1; owner: typeof LEDGER_OWNER; scope: string; date: string; marketplaceIds: string[];
  phase: LedgerPhase; status: LedgerStatus; revision: number;
  lease: { token: string; expiresAt: string } | null; createIntentAt: string | null;
  reportId: string | null; documentId: string | null; reportCreatedAt: string | null;
  attempts: number; nextAttemptAt: string | null; error: string | null;
  manifest: LedgerManifest | null; receipt: LedgerReceipt | null;
};
export const ledgerEnabled = (env: NodeJS.ProcessEnv = process.env) => env.AMAZON_LEDGER_SYNC_ENABLED === "true";
export const ledgerScheduleEnabled = (env: NodeJS.ProcessEnv = process.env) => ledgerEnabled(env) && env.AMAZON_LEDGER_SCHEDULE_ENABLED === "true";
export const terminalLedger = (s: LedgerStatus) => ["COMPLETED","FAILED","CANCELLED","FATAL","CREATE_UNCERTAIN"].includes(s);
export function ledgerDate(date?: string, now = new Date()): string {
  const value = date ?? lastCompleteFbaLedgerUtcDay(now);
  if (validLedgerDate(value) !== value || value > lastCompleteFbaLedgerUtcDay(now)) throw new LedgerEvidenceError("LEDGER_INVALID_RANGE");
  return value;
}
export function initialLedgerState(date: string, markets: string[]): LedgerState {
  const marketplaceIds = Array.from(new Set(markets)).sort();
  if (!marketplaceIds.length || marketplaceIds.some(x=>!/^A[A-Z0-9]+$/.test(x))) throw new LedgerEvidenceError("LEDGER_INVALID_MARKETPLACES");
  return { version:1,owner:LEDGER_OWNER,scope:`EU:COUNTRY:DAILY:${date}:${marketplaceIds.join(",")}`,date,marketplaceIds,
    phase:"CREATE",status:"PENDING",revision:0,lease:null,createIntentAt:null,reportId:null,documentId:null,reportCreatedAt:null,
    attempts:0,nextAttemptAt:null,error:null,manifest:null,receipt:null };
}
export function ledgerRetryAt(now: number, attempts: number, retryAfter?: string | null): string {
  const seconds = Number(retryAfter);
  const explicit = retryAfter ? (Number.isFinite(seconds) ? now + Math.max(0,seconds)*1000 : Date.parse(retryAfter)) : NaN;
  return new Date(Math.max(now + Math.min(900000,15000*2**Math.min(attempts,6)),Number.isFinite(explicit)?explicit:0)).toISOString();
}
export const ledgerHttpStatus = (s: LedgerStatus) => s === "COMPLETED" ? 200 : s === "CREATE_UNCERTAIN" ? 409 : terminalLedger(s) ? 422 : 202;
