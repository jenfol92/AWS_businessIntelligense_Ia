import Papa from "papaparse";
import { parseAllOrdersRows } from "./allOrdersReportParser.ts";
import { resolveSalesAmazonIdentity, type SalesIdentityEvidence } from "./amazonInventoryIdentityResolver.ts";
import type { OrdersWindow } from "./allOrdersSyncPolicy.ts";
import type { OrdersImportRow } from "./allOrdersSyncCoordinator.ts";

/** Pure document gate: malformed/unknown-channel rows cannot silently certify coverage. */
export function parseOrdersDocument(text: string, window: OrdersWindow, evidence: readonly SalesIdentityEvidence[]): OrdersImportRow[] {
  const report = Papa.parse<Record<string,string>>(text, { header: true, delimiter: "\t", skipEmptyLines: "greedy" });
  const headers = new Set((report.meta.fields ?? []).map(h => h.replace(/^\uFEFF/, "").trim().toLowerCase()));
  for (const required of ["amazon-order-id", "sku", "asin", "purchase-date", "quantity", "fulfillment-channel", "sales-channel", "order-status", "item-status"]) if (!headers.has(required)) throw new Error("ALL_ORDERS_MISSING_HEADER:" + required);
  if (report.errors.length) throw new Error("ALL_ORDERS_REPORT_PARSE_ERROR");
  const parsed = parseAllOrdersRows(report.data, { reportId: window.reportId,
    matchProduct: (sku,asin) => resolveSalesAmazonIdentity(sku,asin,evidence).productoId });
  if (parsed.skipped) throw new Error("ALL_ORDERS_INVALID_ROWS");
  // All Orders has historically returned channels beyond the requested EU list.
  // Preserve them; they do not certify coverage for an unrequested marketplace.
  if (parsed.rows.some(r => Date.parse(r.purchase_datetime) < Date.parse(window.dataStartTime) || Date.parse(r.purchase_datetime) > Date.parse(window.dataEndTime))) throw new Error("ALL_ORDERS_OBSERVED_RANGE_MISMATCH");
  return parsed.rows
    .map(r => ({ ...r, identity_resolution: resolveSalesAmazonIdentity(r.seller_sku,r.asin,evidence), report_observed_at: window.observedAt! }));
}
