import type { AmazonOrderItemRow } from "./allOrdersReportParser.ts";
import type { OrdersState, OrdersWindow } from "./allOrdersSyncPolicy.ts";
export type OrdersImportRow = AmazonOrderItemRow & { identity_resolution: unknown; report_observed_at: string };
export type OrdersDependencies = {
  now(): Date; save(state: OrdersState, rows?: OrdersImportRow[]): Promise<void>;
  create(window: OrdersWindow): Promise<string>;
  poll(window: OrdersWindow): Promise<{ status: string; documentId?: string; observedAt?: string }>;
  import(window: OrdersWindow): Promise<OrdersImportRow[]>;
};
/** One durable transition per tick. Persist CREATE intent before external side effect. */
export async function tickAllOrders(state: OrdersState, deps: OrdersDependencies): Promise<OrdersState> {
  if (state.error || state.windows.every(w => w.phase === "COMPLETE") || state.windows.some(w => w.phase === "FAILED")) return state;
  if (state.nextAttemptAt && Date.parse(state.nextAttemptAt) > deps.now().getTime()) return state;
  const w = state.windows.find(w => w.phase !== "COMPLETE")!;
  state.nextAttemptAt = null;
  const originalPhase = w.phase;
  try {
    if (w.phase === "CREATE") {
      if (w.createIntentAt) throw new Error("ALL_ORDERS_CREATE_OUTCOME_UNCERTAIN");
      w.createIntentAt = deps.now().toISOString(); await deps.save(state);
      try { w.reportId = await deps.create(w); }
      catch (error) {
        if ((error as { code?: string }).code === "rate_limited") delete w.createIntentAt;
        throw error;
      }
      if (!w.reportId) throw new Error("ALL_ORDERS_CREATE_OUTCOME_UNCERTAIN");
      w.phase = "POLL"; state.nextAttemptAt = new Date(deps.now().getTime() + 30000).toISOString();
    } else if (w.phase === "POLL") {
      const report = await deps.poll(w); w.processingStatus = report.status;
      if (["CANCELLED", "FATAL"].includes(report.status)) throw new Error(`ALL_ORDERS_REPORT_${report.status}`);
      if (report.status === "DONE") {
        if (!report.documentId || !report.observedAt || Number.isNaN(Date.parse(report.observedAt))) throw new Error("ALL_ORDERS_REPORT_INCOMPLETE");
        w.documentId = report.documentId; w.observedAt = report.observedAt; w.phase = "IMPORT";
      } else if (["IN_QUEUE", "IN_PROGRESS"].includes(report.status)) state.nextAttemptAt = new Date(deps.now().getTime() + 60000).toISOString();
      else throw new Error("ALL_ORDERS_UNEXPECTED_PROCESSING_STATUS");
    } else if (w.phase === "IMPORT") {
      const rows = await deps.import(w);
      w.rowsUpserted = rows.length; w.unmatchedRows = rows.filter(r => !r.producto_id).length;
      w.observedCountries = Array.from(new Set(rows.map(r => r.marketplace_country))).sort();
      w.nonAmazonRows = rows.filter(r => r.marketplace_classification === "NON_AMAZON").length;
      w.unknownMarketplaceRows = rows.filter(r => r.marketplace_classification === "UNKNOWN").length;
      w.phase = "COMPLETE"; w.completedAt = deps.now().toISOString(); w.error = null;
      await deps.save(state, rows); return state;
    }
    w.attempts = 0; w.error = null;
    await deps.save(state);
  } catch (error) {
    const e = error as { code?: string; message?: string; details?: { headers?: Record<string,string> } };
    w.attempts = (w.attempts ?? 0) + 1;
    const temporary = e.code === "rate_limited" && !w.createIntentAt
      || originalPhase !== "CREATE" && ["rate_limited", "server_error", "upstream_fetch_failed"].includes(e.code ?? "");
    if (temporary && w.attempts <= 8) {
      w.phase = originalPhase; w.error = e.message ?? "ALL_ORDERS_TEMPORARY_FAILURE";
      const retry = e.details?.headers?.["retry-after"];
      const seconds = Number(retry);
      const date = retry && !Number.isFinite(seconds) ? Date.parse(retry) : 0;
      const backoff = Math.min(900,30 * 2 ** w.attempts);
      state.nextAttemptAt = new Date(Math.max(deps.now().getTime() + Math.max(backoff, Number.isFinite(seconds) ? seconds : backoff) * 1000, date || 0)).toISOString();
    } else {
      w.phase = "FAILED"; w.error = e.message ?? "ALL_ORDERS_FAILED"; state.error = w.error;
    }
    await deps.save(state);
  }
  return state;
}
