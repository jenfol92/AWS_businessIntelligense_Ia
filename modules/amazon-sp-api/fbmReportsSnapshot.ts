import Papa from "papaparse";
import type { FbmProductIdentity } from "./fbmProductIdentityRepository.ts";
import type { CanonicalFbmInventoryRow } from "./amazonFbmInventoryCanonical.ts";

export const FBM_REPORT_TYPE = "GET_MERCHANT_LISTINGS_ALL_DATA";
export const FBM_REPORT_MARKETPLACE = "A1RKKUPIHCS9HS";
export const FBM_REPORT_LIMITS = Object.freeze({ maxPolls: 12, pollMs: 15_000, requestMs: 30_000, runtimeMs: 300_000, maxBytes: 20 * 1024 * 1024, maxRows: 200_000 });
export type FbmReportRow = { sellerSku: string; quantity: string; fulfillmentChannel: string; asin: string | null; status: string | null };
export type EvidenceError = "REPORT_PARSE_ERROR" | "REPORT_COVERAGE_ERROR" | "REPORT_DUPLICATE_ERROR" | "REPORT_QUANTITY_ERROR";
export class FbmReportEvidenceError extends Error {
  readonly code: EvidenceError;
  constructor(code: EvidenceError) { super(code); this.code = code; }
}
const parseError = (): never => { throw new FbmReportEvidenceError("REPORT_PARSE_ERROR"); };

export function parseFbmListingsReport(text: string): FbmReportRow[] {
  if (Buffer.byteLength(text, "utf8") > FBM_REPORT_LIMITS.maxBytes) parseError();
  const parsed = Papa.parse(text.replace(/^\uFEFF/, ""), { delimiter: "\t", header: false, dynamicTyping: false, skipEmptyLines: true });
  if (parsed.errors.length) parseError();
  const table = parsed.data as string[][];
  const headers = table.shift() ?? [];
  if (headers.length < 3 || headers.some(h => !h || h.length > 200) || new Set(headers).size !== headers.length || table.length > FBM_REPORT_LIMITS.maxRows) parseError();
  const indexes = ["seller-sku", "quantity", "fulfillment-channel"].map(h => headers.indexOf(h));
  if (indexes.some(i => i < 0)) parseError();
  const asin = headers.indexOf("asin1");
  const status = headers.indexOf("status");
  return table.map(row => {
    if (row.length !== headers.length) parseError();
    return { sellerSku: row[indexes[0]], quantity: row[indexes[1]], fulfillmentChannel: row[indexes[2]], asin: asin < 0 ? null : row[asin], status: status < 0 ? null : row[status] };
  });
}

export function normalizeFbmReportSnapshot(reportRows: FbmReportRow[], identities: FbmProductIdentity[], observedAt: string) {
  const bySku = new Map<string, FbmReportRow[]>();
  const expected = new Set(identities.map(i => i.sellerSku));
  for (const row of reportRows) {
    if (row.fulfillmentChannel !== "DEFAULT" || !expected.has(row.sellerSku)) continue;
    const list = bySku.get(row.sellerSku) ?? [];
    list.push(row); bySku.set(row.sellerSku, list);
  }
  const rows: CanonicalFbmInventoryRow[] = [];
  let missingCount = 0, duplicateCount = 0, quantityErrorCount = 0;
  for (const identity of identities) {
    const candidates = bySku.get(identity.sellerSku) ?? [];
    if (candidates.length === 0) { missingCount++; continue; }
    if (candidates.length !== 1) { duplicateCount++; continue; }
    const raw = candidates[0];
    const quantity = Number(raw.quantity);
    // PostgreSQL available_quantity is int4: reject overflow before entering the RPC.
    if (!/^\d+$/.test(raw.quantity) || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2_147_483_647 || (quantity === 0 && raw.quantity !== "0")) { quantityErrorCount++; continue; }
    rows.push({ producto_id: identity.productoId, sku_limpio: identity.sellerSku, seller_sku: identity.sellerSku, asin: raw.asin && /^[A-Z0-9]{10}$/.test(raw.asin) ? raw.asin : null, marketplace_id: FBM_REPORT_MARKETPLACE, available_quantity: quantity, observed_at: observedAt });
  }
  const unknownCount = missingCount + duplicateCount + quantityErrorCount;
  const error: EvidenceError | null = duplicateCount ? "REPORT_DUPLICATE_ERROR" : quantityErrorCount ? "REPORT_QUANTITY_ERROR" : missingCount ? "REPORT_COVERAGE_ERROR" : null;
  return { rows: error ? [] : rows, error, matchedIdentityCount: rows.length, zeroCount: rows.filter(r => r.available_quantity === 0).length, positiveCount: rows.filter(r => r.available_quantity > 0).length, missingCount, duplicateCount, quantityErrorCount, unknownCount };
}
