import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { loadSpApiConfig, type SpApiConfig } from "./config.ts";
import { loadCanonicalFbmProductIdentities, type FbmProductIdentity } from "./fbmProductIdentityRepository.ts";
import { createReport, getReport, getReportDocument, downloadReportDocument, type ReportsRequestOptions } from "./reportsClient.ts";
import { FBM_REPORT_TYPE, FBM_REPORT_MARKETPLACE, FBM_REPORT_LIMITS, parseFbmListingsReport, normalizeFbmReportSnapshot, FbmReportEvidenceError } from "./fbmReportsSnapshot.ts";
import { commitCompleteFbmReportSnapshot, type FbmSnapshotCommit } from "./fbmReportsCommit.ts";

export type FbmReportsStatus = "SUCCESS" | "IDENTITY_ERROR" | "CONFIG_ERROR" | "REPORT_CREATE_ERROR" | "REPORT_PENDING_TIMEOUT" | "REPORT_STATUS_ERROR" | "REPORT_CANCELLED" | "REPORT_FATAL" | "REPORT_DOCUMENT_ERROR" | "REPORT_DOWNLOAD_ERROR" | "REPORT_PARSE_ERROR" | "REPORT_COVERAGE_ERROR" | "REPORT_DUPLICATE_ERROR" | "REPORT_QUANTITY_ERROR" | "COMMIT_ERROR";
export type FbmReportsDependencies = {
  loadIdentities?: () => Promise<FbmProductIdentity[]>;
  loadConfig?: () => SpApiConfig;
  request?: ReportsRequestOptions["request"];
  fetchDocument?: typeof fetch;
  commit?: FbmSnapshotCommit;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};
const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9._:-]{1,500}$/.test(id);
function identityKey(identities: FbmProductIdentity[]): string {
  if (!identities.length || new Set(identities.map(i => i.sellerSku)).size !== identities.length || new Set(identities.map(i => i.productoId)).size !== identities.length || identities.some(i => !i.productoId || !i.sellerSku || i.sellerSku !== i.sellerSku.trim() || i.skuLimpio !== i.sellerSku)) throw new Error("INVALID_IDENTITIES");
  return JSON.stringify(identities.map(i => [i.productoId, i.sellerSku]).sort((a, b) => a[0].localeCompare(b[0])));
}

/** Production service, ES source only. One physical OWN_ES/FBM pool; no marketplace loop. */
export async function syncAmazonFbmInventoryFromReports(deps: FbmReportsDependencies = {}) {
  const now = deps.now ?? Date.now;
  const started = now();
  const deadline = AbortSignal.timeout(FBM_REPORT_LIMITS.runtimeMs);
  const result = {
    status: "IDENTITY_ERROR" as FbmReportsStatus, reportType: FBM_REPORT_TYPE, marketplace: FBM_REPORT_MARKETPLACE,
    operationalPool: "OWN_ES", fulfillment: "FBM", runId: null as string | null, reportId: null as string | null,
    processingStatus: null as string | null, expectedIdentityCount: 0, matchedIdentityCount: 0,
    zeroCount: 0, positiveCount: 0, unknownCount: 0, missingCount: 0, duplicateCount: 0, quantityErrorCount: 0,
    errorCount: 0, rowsCommitted: 0, commitOutcome: "NOT_ATTEMPTED" as "NOT_ATTEMPTED" | "CONFIRMED" | "UNKNOWN",
    calls: { createReport: 0, getReport: 0, getReportDocument: 0, download: 0, commit: 0 },
    requests: [] as Array<{ operation: string; httpStatus: number; requestId: string | null }>,
    timingsMs: {} as Record<string, number>, totalMs: 0,
  };
  let stage: FbmReportsStatus = "IDENTITY_ERROR";
  const checkTime = () => { deadline.throwIfAborted(); if (now() - started >= FBM_REPORT_LIMITS.runtimeMs) throw new Error("RUNTIME_LIMIT"); };
  const timed = async <T>(name: string, fn: () => Promise<T>) => {
    checkTime(); const begin = now();
    try { return await fn(); } finally { result.timingsMs[name] = (result.timingsMs[name] ?? 0) + now() - begin; }
  };
  const finish = () => { result.totalMs = now() - started; return result; };
  try {
    const loadIdentities = deps.loadIdentities ?? (() => loadCanonicalFbmProductIdentities(AbortSignal.any([deadline, AbortSignal.timeout(FBM_REPORT_LIMITS.requestMs)])));
    const identities = await timed("identities", loadIdentities);
    result.expectedIdentityCount = identities.length;
    const initialIdentityKey = identityKey(identities);
    stage = "CONFIG_ERROR";
    const config = (deps.loadConfig ?? loadSpApiConfig)();
    if (config.region !== "EU" || config.endpoint !== "https://sellingpartnerapi-eu.amazon.com" || config.useAwsSigV4) throw new Error("UNSUPPORTED_CONFIG");
    const secrets = [config.sellerId, config.lwaClientId, config.lwaClientSecret, config.lwaRefreshToken, config.awsAccessKeyId, config.awsSecretAccessKey, config.awsRoleArn].filter((v): v is string => Boolean(v));
    const safeId = (id: unknown) => validId(id) && !secrets.some(s => id.includes(s)) ? id : null;
    const requestOptions = (): ReportsRequestOptions => ({ request: deps.request, signal: AbortSignal.any([deadline, AbortSignal.timeout(FBM_REPORT_LIMITS.requestMs)]), retryExpiredAccessToken: false, rateLimitRetry: { maxRetries: 0 },
      onResponseMetadata(m) { result.requests.push({ operation: ["createReport", "getReport", "getReportDocument"].includes(m.operation) ? m.operation : "reports", httpStatus: m.status, requestId: safeId(m.requestId) }); },
    });
    stage = "REPORT_CREATE_ERROR";
    result.calls.createReport++;
    const created = await timed("createReport", () => createReport({ reportType: FBM_REPORT_TYPE, marketplaceIds: [FBM_REPORT_MARKETPLACE] }, requestOptions()));
    if (!validId(created.reportId) || !safeId(created.reportId)) throw new Error("INVALID_REPORT_ID");
    result.reportId = created.reportId;
    stage = "REPORT_PENDING_TIMEOUT";
    let report: Awaited<ReturnType<typeof getReport>> | null = null;
    for (let poll = 0; poll < FBM_REPORT_LIMITS.maxPolls; poll++) {
      stage = "REPORT_PENDING_TIMEOUT";
      await timed("pollWait", () => (deps.sleep ?? ((ms, signal) => delay(ms, undefined, { signal })))(FBM_REPORT_LIMITS.pollMs, deadline));
      checkTime(); result.calls.getReport++;
      stage = "REPORT_STATUS_ERROR";
      report = await timed("getReport", () => getReport(created.reportId, requestOptions()));
      if (report.reportId !== created.reportId || report.reportType !== FBM_REPORT_TYPE || report.marketplaceIds?.length !== 1 || report.marketplaceIds[0] !== FBM_REPORT_MARKETPLACE) throw new Error("REPORT_SCOPE_MISMATCH");
      if (!["IN_QUEUE", "IN_PROGRESS", "DONE", "CANCELLED", "FATAL"].includes(report.processingStatus)) throw new Error("INVALID_REPORT_STATUS");
      result.processingStatus = report.processingStatus;
      if (report.processingStatus === "CANCELLED" || report.processingStatus === "FATAL") {
        stage = report.processingStatus === "CANCELLED" ? "REPORT_CANCELLED" : "REPORT_FATAL"; throw new Error(stage);
      }
      if (report.processingStatus === "DONE") break;
    }
    if (report?.processingStatus !== "DONE") { stage = "REPORT_PENDING_TIMEOUT"; throw new Error("POLL_LIMIT"); }
    stage = "REPORT_DOCUMENT_ERROR";
    if (!validId(report.reportDocumentId)) throw new Error("INVALID_DOCUMENT_ID");
    const documentId = report.reportDocumentId;
    result.calls.getReportDocument++;
    const document = await timed("getReportDocument", () => getReportDocument(documentId, requestOptions()));
    if (document.reportDocumentId !== documentId) throw new Error("DOCUMENT_ID_MISMATCH");
    stage = "REPORT_DOWNLOAD_ERROR";
    result.calls.download++;
    const text = await timed("download", () => downloadReportDocument(document, { signal: AbortSignal.any([deadline, AbortSignal.timeout(FBM_REPORT_LIMITS.requestMs)]), maxBytes: FBM_REPORT_LIMITS.maxBytes, fetchDocument: deps.fetchDocument }));
    stage = "REPORT_PARSE_ERROR";
    const parsed = await timed("parse", async () => parseFbmListingsReport(text));
    // Use report creation time so an older slow report cannot become a newer physical observation.
    if (!report.createdTime || !Number.isFinite(Date.parse(report.createdTime)) || Date.parse(report.createdTime) > now() + 60_000) throw new Error("INVALID_REPORT_TIME");
    const observedAt = new Date(report.createdTime).toISOString();
    const normalized = await timed("normalize", async () => normalizeFbmReportSnapshot(parsed, identities, observedAt));
    const { rows, error, ...counts } = normalized;
    Object.assign(result, counts);
    if (error) { stage = error; throw new Error(error); }
    // Fail closed if activation/SKU membership changed while Amazon generated the report.
    stage = "REPORT_COVERAGE_ERROR";
    const latest = await timed("identityRecheck", loadIdentities);
    if (identityKey(latest) !== initialIdentityKey) throw new Error("IDENTITY_UNIVERSE_CHANGED");
    checkTime();
    stage = "COMMIT_ERROR";
    result.runId = randomUUID(); result.calls.commit++; result.commitOutcome = "UNKNOWN";
    result.rowsCommitted = await timed("commit", () => commitCompleteFbmReportSnapshot(result.runId!, observedAt, identities.length, rows, AbortSignal.any([deadline, AbortSignal.timeout(FBM_REPORT_LIMITS.requestMs)]), deps.commit));
    result.commitOutcome = "CONFIRMED"; result.status = "SUCCESS";
    return finish();
  } catch (error) {
    result.status = error instanceof FbmReportEvidenceError ? error.code : stage;
    result.errorCount = Math.max(1, result.unknownCount);
    if (!result.matchedIdentityCount) result.unknownCount = result.expectedIdentityCount;
    return finish();
  }
}
