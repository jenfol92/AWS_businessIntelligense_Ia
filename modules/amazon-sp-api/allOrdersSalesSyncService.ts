// Dedicated All Orders owner. No inventory writes, no ventas_diarias consumers.
import { DEFAULT_EU_MARKETPLACE_IDS } from "./config";
import { createReport, getReport, getReportDocument, downloadReportDocument } from "./reportsClient";
import { ALL_ORDERS_REPORT_TYPE } from "./allOrdersReportParser";
import { parseOrdersDocument } from "./allOrdersDocument";
import { loadSalesIdentityEvidence } from "./operationalAmazonIdentityRepository";
import { assertSameScope, buildOrdersState, type OrdersState, type OrdersWindow } from "./allOrdersSyncPolicy";
import { tickAllOrders, type OrdersImportRow } from "./allOrdersSyncCoordinator";
import { beginOrdersOperation, readOrdersOperation, findOpenOrdersOperation, leaseOrdersOperation, saveOrdersOperation, releaseOrdersOperation } from "./allOrdersSyncRepository";
export { splitIntoWindows } from "./allOrdersSyncPolicy";
function assertOrdersEnabled() {
  if (process.env.AMAZON_ORDERS_CANONICAL_ENABLED !== "true") throw new Error("ALL_ORDERS_CANONICAL_DISABLED");
}
export function summarizeAllOrders(jobId: string, raw: OrdersState) {
  const failed = raw.windows.some(w => w.phase === "FAILED");
  const done = raw.windows.every(w => w.phase === "COMPLETE");
  return { ok: !failed, status: failed ? "FAILED" as const : done ? "COMPLETED" as const : "PENDING" as const,
    jobId, fromDate: raw.fromDate, toDate: raw.toDate, marketplaceIds: raw.marketplaceIds,
    rowsUpserted: raw.windows.reduce((n,w) => n + (w.rowsUpserted ?? 0),0), unmatchedRows: raw.windows.reduce((n,w) => n + (w.unmatchedRows ?? 0),0),
    windows: raw.windows, nextAttemptAt: raw.nextAttemptAt, error: raw.error };
}
async function importWindow(window: OrdersWindow, signal: AbortSignal): Promise<OrdersImportRow[]> {
  const doc = await getReportDocument(window.documentId!, { signal, rateLimitRetry: { maxRetries: 0 } });
  if (doc.reportDocumentId !== window.documentId) throw new Error("ALL_ORDERS_DOCUMENT_MISMATCH");
  const text = await downloadReportDocument(doc, { signal, maxBytes: 32 * 1024 * 1024 });
  const evidence = await loadSalesIdentityEvidence(signal);
  signal.throwIfAborted();
  return parseOrdersDocument(text,window,evidence);
}
/** Server-side recovery: one transition, never loops/sleeps inside the request. */
export async function resumeAllOrdersSync(jobId: string, _options: { waitMs?: number } = {}) {
  assertOrdersEnabled();
  const operation = await readOrdersOperation(jobId);
  if (operation.status !== "PENDING") return summarizeAllOrders(jobId, operation.state);
  const leased = await leaseOrdersOperation(jobId);
  if (!leased) return summarizeAllOrders(jobId, operation.state);
  const signal = AbortSignal.timeout(45000);
  try {
    const state = await tickAllOrders(leased.state, {
      now: () => new Date(), save: (state, rows) => saveOrdersOperation(jobId,leased.token,state,rows),
      create: async w => (await createReport({ reportType: ALL_ORDERS_REPORT_TYPE, marketplaceIds: [w.marketplaceId], dataStartTime: w.dataStartTime, dataEndTime: w.dataEndTime }, { signal, rateLimitRetry: { maxRetries: 0 } })).reportId,
      poll: async w => {
        const r = await getReport(w.reportId!, { signal, rateLimitRetry: { maxRetries: 0 } });
        if (r.reportId !== w.reportId || r.reportType !== ALL_ORDERS_REPORT_TYPE || !r.marketplaceIds || r.marketplaceIds.length !== 1 || r.marketplaceIds[0] !== w.marketplaceId) throw new Error("ALL_ORDERS_REPORT_SCOPE_MISMATCH");
        if (!r.dataStartTime || !r.dataEndTime || Number.isNaN(Date.parse(r.dataStartTime)) || Number.isNaN(Date.parse(r.dataEndTime)) || Date.parse(r.dataStartTime) > Date.parse(w.dataStartTime) || Date.parse(r.dataEndTime) < Date.parse(w.dataEndTime)) throw new Error("ALL_ORDERS_REPORT_RANGE_MISMATCH");
        return { status: r.processingStatus, documentId: r.reportDocumentId, observedAt: r.createdTime };
      },
      import: w => importWindow(w,signal),
    });
    return summarizeAllOrders(jobId,state);
  } finally { await releaseOrdersOperation(jobId,leased.token); }
}
export async function startAllOrdersSync(params: { fromDate: string; toDate: string; waitMs?: number; marketplaceIds?: string[] }) {
  assertOrdersEnabled();
  const state = buildOrdersState(params.fromDate,params.toDate,params.marketplaceIds ?? [...DEFAULT_EU_MARKETPLACE_IDS],new Date());
  const jobId = await beginOrdersOperation(state);
  const current = await readOrdersOperation(jobId); assertSameScope(current.state,state);
  return resumeAllOrdersSync(jobId);
}
export async function findOpenAllOrdersSyncJobId(_maxAgeHours = 24) {
  return findOpenOrdersOperation();
}
