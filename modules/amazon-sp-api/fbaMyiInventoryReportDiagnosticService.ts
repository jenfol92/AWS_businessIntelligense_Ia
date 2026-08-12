import { extractTwinlySkuFromSellerSku } from "@/modules/imports/shared/twinlySku";
import { AMAZON_MARKETPLACE_ID_BY_COUNTRY } from "@/modules/imports/shared/amazonMarketplaceIds";
import {
  createReport,
  downloadReportDocument,
  getReport,
  getReportDocument,
} from "./reportsClient";
import {
  getField,
  parseInteger,
  parseReportRows,
} from "./spApiReportImportUtils";

export const FBA_MYI_UNSUPPRESSED_REPORT_TYPE =
  "GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA";

const ALLOWED_MARKETPLACES = ["ES", "FR", "DE", "IT", "GB", "PL", "SE"] as const;
export type FbaMyiDiagnosticMarketplace = (typeof ALLOWED_MARKETPLACES)[number];

const MARKETPLACE_ENV_BY_CODE: Record<FbaMyiDiagnosticMarketplace, string> = {
  ES: "AMAZON_MARKETPLACE_ES",
  FR: "AMAZON_MARKETPLACE_FR",
  DE: "AMAZON_MARKETPLACE_DE",
  IT: "AMAZON_MARKETPLACE_IT",
  GB: "AMAZON_MARKETPLACE_GB",
  PL: "AMAZON_MARKETPLACE_PL",
  SE: "AMAZON_MARKETPLACE_SE",
};

export type FbaMyiDiagnosticRow = {
  skuOriginal: string;
  skuLimpio: string | null;
  asin: string;
  fnsku: string;
  condition: string;
  mfnListingExists: string;
  mfnFulfillableQuantity: number;
  afnListingExists: string;
  afnWarehouseQuantity: number;
  afnFulfillableQuantity: number;
  afnUnsellableQuantity: number;
  afnReservedQuantity: number;
  afnTotalQuantity: number;
  afnInboundWorkingQuantity: number;
  afnInboundShippedQuantity: number;
  afnInboundReceivingQuantity: number;
  afnResearchingQuantity: number;
  stockFbaAvailable: number;
  stockFbaReserved: number;
  stockFbaUnfulfillable: number;
  stockFbaInboundAmazon: number;
  stockFbmAvailable: number;
  raw: Record<string, unknown>;
};

export type FbaMyiTotalsByCleanSku = {
  skuLimpio: string;
  fbaAvailable: number;
  fbaReserved: number;
  fbaUnfulfillable: number;
  fbaInboundAmazon: number;
  fbmAvailable: number;
  rows: number;
};

export type FbaMyiTotalsByMsku = FbaMyiTotalsByCleanSku & {
  skuOriginal: string;
};

export type FbaMyiParseDiagnostic = {
  ok: true;
  reportType: typeof FBA_MYI_UNSUPPRESSED_REPORT_TYPE;
  marketplace: FbaMyiDiagnosticMarketplace;
  marketplaceId: string;
  reportId: string;
  processingStatus: string;
  rowsTotal: number;
  matchedRows: FbaMyiDiagnosticRow[];
  totalsByCleanSku: FbaMyiTotalsByCleanSku[];
  totalsByMsku: FbaMyiTotalsByMsku[];
  warnings: string[];
};

export function resolveFbaMyiMarketplaceCode(
  raw: string | null,
): FbaMyiDiagnosticMarketplace {
  const code = String(raw ?? "DE")
    .trim()
    .toUpperCase();
  if ((ALLOWED_MARKETPLACES as readonly string[]).includes(code)) {
    return code as FbaMyiDiagnosticMarketplace;
  }
  throw new Error(`Marketplace no soportado: ${code || "(vacio)"}. Usa ES, FR, DE, IT, GB, PL o SE.`);
}

export function resolveFbaMyiMarketplaceId(
  marketplace: FbaMyiDiagnosticMarketplace,
): string {
  const envKey = MARKETPLACE_ENV_BY_CODE[marketplace];
  const fromEnv = String(process.env[envKey] ?? "").trim();
  if (fromEnv) return fromEnv;

  const fallback = AMAZON_MARKETPLACE_ID_BY_COUNTRY[marketplace];
  if (fallback) return fallback;

  throw new Error(`Marketplace no configurado: ${marketplace}`);
}

export async function requestFbaMyiUnsuppressedReport(params: {
  marketplaceId: string;
}): Promise<{ reportId: string }> {
  return createReport({
    reportType: FBA_MYI_UNSUPPRESSED_REPORT_TYPE,
    marketplaceIds: [params.marketplaceId],
  });
}

export async function getFbaMyiReportStatus(reportId: string) {
  return getReport(reportId);
}

export async function downloadFbaMyiReportContent(reportDocumentId: string): Promise<string> {
  const document = await getReportDocument(reportDocumentId);
  return downloadReportDocument(document);
}

function parseMyiRow(raw: Record<string, unknown>): FbaMyiDiagnosticRow {
  const skuOriginal = getField(raw, ["sku", "seller-sku", "seller sku", "msku"]);
  const skuLimpio = extractTwinlySkuFromSellerSku(skuOriginal);
  const afnInboundWorkingQuantity = parseInteger(
    getField(raw, ["afn-inbound-working-quantity", "afn inbound working quantity"]),
  );
  const afnInboundShippedQuantity = parseInteger(
    getField(raw, ["afn-inbound-shipped-quantity", "afn inbound shipped quantity"]),
  );
  const afnInboundReceivingQuantity = parseInteger(
    getField(raw, ["afn-inbound-receiving-quantity", "afn inbound receiving quantity"]),
  );
  const afnFulfillableQuantity = parseInteger(
    getField(raw, ["afn-fulfillable-quantity", "afn fulfillable quantity"]),
  );
  const afnReservedQuantity = parseInteger(
    getField(raw, ["afn-reserved-quantity", "afn reserved quantity"]),
  );
  const afnUnsellableQuantity = parseInteger(
    getField(raw, ["afn-unsellable-quantity", "afn unsellable quantity"]),
  );
  const mfnFulfillableQuantity = parseInteger(
    getField(raw, ["mfn-fulfillable-quantity", "mfn fulfillable quantity"]),
  );

  return {
    skuOriginal,
    skuLimpio,
    asin: getField(raw, ["asin"]),
    fnsku: getField(raw, ["fnsku"]),
    condition: getField(raw, ["condition", "condition-type", "condition type"]),
    mfnListingExists: getField(raw, ["mfn-listing-exists", "mfn listing exists"]),
    mfnFulfillableQuantity,
    afnListingExists: getField(raw, ["afn-listing-exists", "afn listing exists"]),
    afnWarehouseQuantity: parseInteger(
      getField(raw, ["afn-warehouse-quantity", "afn warehouse quantity"]),
    ),
    afnFulfillableQuantity,
    afnUnsellableQuantity,
    afnReservedQuantity,
    afnTotalQuantity: parseInteger(
      getField(raw, ["afn-total-quantity", "afn total quantity"]),
    ),
    afnInboundWorkingQuantity,
    afnInboundShippedQuantity,
    afnInboundReceivingQuantity,
    afnResearchingQuantity: parseInteger(
      getField(raw, ["afn-researching-quantity", "afn researching quantity"]),
    ),
    stockFbaAvailable: afnFulfillableQuantity,
    stockFbaReserved: afnReservedQuantity,
    stockFbaUnfulfillable: afnUnsellableQuantity,
    stockFbaInboundAmazon:
      afnInboundWorkingQuantity +
      afnInboundShippedQuantity +
      afnInboundReceivingQuantity,
    stockFbmAvailable: mfnFulfillableQuantity,
    raw,
  };
}

function matchesSkuFilter(row: FbaMyiDiagnosticRow, skuFilter: string | null): boolean {
  if (!skuFilter) return true;
  const needle = skuFilter.trim().toLowerCase();
  if (!needle) return true;
  return (
    row.skuOriginal.toLowerCase().includes(needle) ||
    String(row.skuLimpio ?? "").toLowerCase() === needle
  );
}

function emptyCleanSkuTotals(skuLimpio: string): FbaMyiTotalsByCleanSku {
  return {
    skuLimpio,
    fbaAvailable: 0,
    fbaReserved: 0,
    fbaUnfulfillable: 0,
    fbaInboundAmazon: 0,
    fbmAvailable: 0,
    rows: 0,
  };
}

function addRowToTotals(total: FbaMyiTotalsByCleanSku, row: FbaMyiDiagnosticRow) {
  total.fbaAvailable += row.stockFbaAvailable;
  total.fbaReserved += row.stockFbaReserved;
  total.fbaUnfulfillable += row.stockFbaUnfulfillable;
  total.fbaInboundAmazon += row.stockFbaInboundAmazon;
  total.fbmAvailable += row.stockFbmAvailable;
  total.rows += 1;
}

function buildTotalsByCleanSku(rows: FbaMyiDiagnosticRow[]): FbaMyiTotalsByCleanSku[] {
  const bySku = new Map<string, FbaMyiTotalsByCleanSku>();
  for (const row of rows) {
    if (!row.skuLimpio) continue;
    const current = bySku.get(row.skuLimpio) ?? emptyCleanSkuTotals(row.skuLimpio);
    addRowToTotals(current, row);
    bySku.set(row.skuLimpio, current);
  }
  return Array.from(bySku.values()).sort((a, b) => a.skuLimpio.localeCompare(b.skuLimpio));
}

function buildTotalsByMsku(rows: FbaMyiDiagnosticRow[]): FbaMyiTotalsByMsku[] {
  const byMsku = new Map<string, FbaMyiTotalsByMsku>();
  for (const row of rows) {
    const skuLimpio = row.skuLimpio ?? "";
    const key = `${row.skuOriginal}::${skuLimpio}`;
    const current =
      byMsku.get(key) ??
      ({
        ...emptyCleanSkuTotals(skuLimpio),
        skuOriginal: row.skuOriginal,
      } satisfies FbaMyiTotalsByMsku);
    addRowToTotals(current, row);
    byMsku.set(key, current);
  }
  return Array.from(byMsku.values()).sort((a, b) =>
    a.skuOriginal.localeCompare(b.skuOriginal),
  );
}

export function buildFbaMyiParseDiagnostic(params: {
  content: string;
  marketplace: FbaMyiDiagnosticMarketplace;
  marketplaceId: string;
  reportId: string;
  processingStatus: string;
  skuFilter?: string | null;
}): FbaMyiParseDiagnostic {
  const warnings: string[] = [];
  const parsedRows = parseReportRows(params.content).map(parseMyiRow);
  const filteredRows = parsedRows.filter((row) =>
    matchesSkuFilter(row, params.skuFilter ?? null),
  );

  const maxRows = 500;
  const matchedRows = filteredRows.slice(0, maxRows);
  if (filteredRows.length > maxRows) {
    warnings.push(
      `matchedRows limitado a ${maxRows} filas de ${filteredRows.length}; usa sku= para acotar.`,
    );
  }

  if (params.skuFilter && filteredRows.length === 0) {
    warnings.push(`No se encontraron filas para sku=${params.skuFilter}.`);
  }

  return {
    ok: true,
    reportType: FBA_MYI_UNSUPPRESSED_REPORT_TYPE,
    marketplace: params.marketplace,
    marketplaceId: params.marketplaceId,
    reportId: params.reportId,
    processingStatus: params.processingStatus,
    rowsTotal: parsedRows.length,
    matchedRows,
    totalsByCleanSku: buildTotalsByCleanSku(filteredRows),
    totalsByMsku: buildTotalsByMsku(filteredRows),
    warnings,
  };
}
