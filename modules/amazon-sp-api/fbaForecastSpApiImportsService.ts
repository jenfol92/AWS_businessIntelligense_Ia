import Papa from "papaparse";
import { isUtcDateOnly } from "./fbaSalesSyncPolicy";
import { supabaseAdmin } from "@/server/supabase/adminClient";
import { loadSpApiConfig } from "./config";
import { spApiRequest, type SpApiResponseMetadata } from "./spApiClient";
import { SpApiError } from "./errors";
import {
  assertInventorySummaryPageBudget,
  assertInventorySummaryRequestBudget,
  assertInventorySummaryRuntimeBudget,
  inventorySummaryMaxPagesPerBatch,
  inventorySummaryMaxRequestsPerRun,
  inventorySummaryMaxRuntimeMs,
} from "./inventorySummaryRequestPolicy";
import {
  createWaitAndDownloadReport,
  getField,
  normalizeHeader,
  parseDateOnly,
  parseInteger,
  parseNumberOrNull,
  parseReportRows,
  sha256,
} from "./spApiReportImportUtils";
import {
  downloadReportDocument,
  getReport,
  getReportDocument,
} from "./reportsClient";
import { inventoryIdentityKey, resolveProductMatchesBySku } from "./skuProductMatching";
import {
  buildCanonicalSalesMarketplaceScope,
  observedValidSalesMarketplaceId,
  resolveFbaSaleCountry,
} from "./marketplaceMapping";
import type { SpApiReport } from "./types";
import { importAmazonFbaLedgerSummaryFromText } from "@/modules/imports/amazon-fba-ledger-summary/service";
import {
  buildCanonicalInventorySnapshot,
  type IncompleteInventoryObservation,
  type InventorySummaryObservation,
} from "./inventorySummaryCanonicalSnapshot";
import {
  InventorySummaryRequestPacer,
  MAX_THROTTLE_RESUMES_PER_BATCH,
  inventorySummarySellerSkuBatchSize,
  normalizedConfirmedSellerSkus,
  requestInventorySummaryBatchWithThrottleResume,
  requestFilteredInventorySummaries,
  splitSellerSkuBatches,
} from "./inventorySummaryFilteredRequest";
import { inventoryOperationalPool, newInventoryAttemptId, sellerSkusSafeHash } from "./inventorySummaryTelemetryUtils";
import {
  persistInventorySummaryRequestTelemetry,
  type InventorySummaryRequestTelemetry,
} from "./inventorySummaryRequestTelemetry";
import {
  PAN_EU_REFERENCE_MARKETPLACE_ID,
  UK_REFERENCE_MARKETPLACE_ID,
} from "./inventorySummaryPoolPolicy";

const AMAZON_FULFILLED_SHIPMENTS_REPORT_TYPE =
  "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL";
const FBA_SALES_SOURCE = "spapi_fba_customer_shipment_sales";
const FBA_LEDGER_REPORT_TYPE = "GET_LEDGER_SUMMARY_VIEW_DATA";
const BATCH_SIZE = 200;

export const SUPPORTED_FBA_SALES_REPORT_TYPES = [
  AMAZON_FULFILLED_SHIPMENTS_REPORT_TYPE,
] as const;

export type SupportedFbaSalesReportType =
  (typeof SUPPORTED_FBA_SALES_REPORT_TYPES)[number];

type ImportDateRange = {
  fromDate: string;
  toDate: string;
  marketplaceIds?: string[];
};

type ImportSummary = {
  ok: boolean;
  reportId?: string;
  status?: string;
  processingStatus?: string | null;
  amazonReport?: SpApiReport | null;
  requestedCreateReportPayload?: {
    reportType: string;
    marketplaceIds: string[];
    dataStartTime?: string;
    dataEndTime?: string;
    reportOptions?: Record<string, string>;
  };
  rowsParsed: number;
  rowsUpserted: number;
  ventasDiariasUpserted?: number;
  ventasDiariasSync?: FbaSalesVentasDiariasSyncResult;
  deletedPreviousRows?: number;
  insertedRows?: number;
  insertedUnits?: number;
  skippedSourceConflicts?: number;
  orphanRows?: number;
  orphanUnits?: number;
  matchedRows: number;
  unmatchedRows: number;
  warnings: string[];
  error?: string;
  columnsDetected?: string[];
  diagnosticDocumentExcerpt?: string | null;
  sampleSanitizedRow?: Record<string, unknown> | null;
};

type FbaSalesVentasDiariasSyncResult = {
  deletedPreviousRows: number;
  insertedRows: number;
  insertedUnits: number;
  skippedSourceConflicts: number;
  skippedUnits: number;
  orphanRows: number;
  orphanUnits: number;
  marketplaces: string[];
  orphanMarketplaces: string[];
  orphanCountries: string[];
};

type PersistFbaSalesReportDocumentParams = {
  commit: (rows: Record<string, unknown>[], marketplaceIds: string[]) => Promise<Record<string, unknown>>;
  reportId: string;
  reportType: SupportedFbaSalesReportType;
  marketplaceIds: string[];
  fromDate: string;
  toDate: string;
  documentText: string;
  status: string;
  processingStatus: string | null;
  amazonReport?: SpApiReport | null;
  requestedCreateReportPayload?: ImportSummary["requestedCreateReportPayload"];
  warnings?: string[];
  diagnosticDocumentExcerpt?: string | null;
};

function marketplaceIdsFromInput(marketplaceIds?: string[]): string[] {
  const fromInput = (marketplaceIds ?? []).map((v) => v.trim()).filter(Boolean);
  if (fromInput.length > 0) return Array.from(new Set(fromInput));
  return loadSpApiConfig().marketplaceIds;
}

function toAmazonDateTime(date: string, endOfDay = false): string {
  return `${date}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

function addUtcDaysToDateOnly(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function firstNonEmpty(...values: string[]): string {
  return values.find((v) => v.trim() !== "")?.trim() ?? "";
}

export function isSupportedFbaSalesReportType(
  value: string | undefined,
): value is SupportedFbaSalesReportType {
  return SUPPORTED_FBA_SALES_REPORT_TYPES.includes(
    value as SupportedFbaSalesReportType,
  );
}

const AMAZON_FULFILLED_ALLOWED_RAW_FIELDS = [
  "amazon-order-id",
  "shipment-id",
  "shipment-item-id",
  "purchase-date",
  "payments-date",
  "shipment-date",
  "reporting-date",
  "sku",
  "quantity-shipped",
  "currency",
  "item-price",
  "shipping-price",
  "ship-country",
  "fulfillment-center-id",
  "fulfillment-channel",
  "sales-channel",
];

const AMAZON_ORDER_ID_FIELDS = ["amazon-order-id", "amazon order id", "numero de pedido de amazon"];
const SHIPMENT_ID_FIELDS = ["shipment-id", "shipment id"];
const SHIPMENT_ITEM_ID_FIELDS = ["shipment-item-id", "shipment item id"];
const PURCHASE_DATE_FIELDS = ["purchase-date", "purchase date"];
const PAYMENTS_DATE_FIELDS = ["payments-date", "payments date"];
const SHIPMENT_DATE_FIELDS = ["shipment-date", "shipment date", "fecha de envio"];
const REPORTING_DATE_FIELDS = ["reporting-date", "reporting date"];
const SKU_FIELDS = ["sku", "seller-sku", "seller sku", "sku del vendedor"];
const QUANTITY_SHIPPED_FIELDS = ["quantity-shipped", "quantity shipped", "cantidad enviada"];
const CURRENCY_FIELDS = ["currency", "currency-code", "currency code", "divisa"];
const ITEM_PRICE_FIELDS = ["item-price", "item price", "precio del articulo"];
const SHIPPING_PRICE_FIELDS = ["shipping-price", "shipping price", "precio de la entrega"];
const SHIP_COUNTRY_FIELDS = ["ship-country", "ship country", "codigo del pais de entrega"];
const FULFILLMENT_CENTER_FIELDS = [
  "fulfillment-center-id",
  "fulfillment center id",
  "centro logistico",
];
const FULFILLMENT_CHANNEL_FIELDS = [
  "fulfillment-channel",
  "fulfillment channel",
  "canal de gestion logistica",
];
const SALES_CHANNEL_FIELDS = ["sales-channel", "sales channel", "canal de venta"];

export function sanitizeAmazonFulfilledShipmentRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = new Set(AMAZON_FULFILLED_ALLOWED_RAW_FIELDS);
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(row)) {
    const normalized = key.trim().toLowerCase();
    if (allowed.has(normalized)) sanitized[normalized] = value;
  }

  return sanitized;
}

function normalizeAmazonFulfilledShipmentRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    "amazon-order-id": getField(row, AMAZON_ORDER_ID_FIELDS),
    "shipment-id": getField(row, SHIPMENT_ID_FIELDS),
    "shipment-item-id": getField(row, SHIPMENT_ITEM_ID_FIELDS),
    "purchase-date": getField(row, PURCHASE_DATE_FIELDS),
    "payments-date": getField(row, PAYMENTS_DATE_FIELDS),
    "shipment-date": getField(row, SHIPMENT_DATE_FIELDS),
    "reporting-date": getField(row, REPORTING_DATE_FIELDS),
    sku: getField(row, SKU_FIELDS),
    "quantity-shipped": getField(row, QUANTITY_SHIPPED_FIELDS),
    currency: getField(row, CURRENCY_FIELDS),
    "item-price": getField(row, ITEM_PRICE_FIELDS),
    "shipping-price": getField(row, SHIPPING_PRICE_FIELDS),
    "ship-country": getField(row, SHIP_COUNTRY_FIELDS),
    "fulfillment-center-id": getField(row, FULFILLMENT_CENTER_FIELDS),
    "fulfillment-channel": getField(row, FULFILLMENT_CHANNEL_FIELDS),
    "sales-channel": getField(row, SALES_CHANNEL_FIELDS),
  };
}

function safeRawForSalesReport(
  reportType: SupportedFbaSalesReportType,
  row: Record<string, unknown>,
): Record<string, unknown> {
  if (reportType === AMAZON_FULFILLED_SHIPMENTS_REPORT_TYPE) {
    return normalizeAmazonFulfilledShipmentRow(row);
  }
  return sanitizeAmazonFulfilledShipmentRow(row);
}

function buildFbaSalesNaturalFingerprint(params: {
  row: Record<string, unknown>;
  skuOriginal: string;
  saleDate: string;
}): string {
  const amazonOrderId = getField(params.row, ["amazon-order-id", "amazon order id"]);
  const shipmentId = getField(params.row, ["shipment-id", "shipment id"]);
  const shipmentItemId = getField(params.row, ["shipment-item-id", "shipment item id"]);

  return sha256(
    [
      amazonOrderId,
      shipmentId,
      shipmentItemId,
      params.skuOriginal,
      params.saleDate,
    ].join("|"),
  );
}

async function upsertRows(table: string, rows: Record<string, unknown>[], onConflict: string) {
  let affected = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabaseAdmin.from(table).upsert(batch, { onConflict });
    if (error) throw new Error(error.message);
    affected += batch.length;
  }
  return affected;
}

export async function parseAndPersistFbaSalesReportDocument(
  params: PersistFbaSalesReportDocumentParams,
): Promise<ImportSummary & { reportId: string; ventasDiariasUpserted: number }> {
  const warnings = [...(params.warnings ?? [])];
  const parsed = Papa.parse<Record<string, string>>(params.documentText, {
    header: true, delimiter: params.documentText.includes("\t") ? "\t" : ",", skipEmptyLines: "greedy",
  });
  const fields = new Set((parsed.meta.fields ?? []).map(normalizeHeader));
  const requiredFields = [AMAZON_ORDER_ID_FIELDS, SHIPMENT_ID_FIELDS, SHIPMENT_ITEM_ID_FIELDS, SKU_FIELDS, QUANTITY_SHIPPED_FIELDS, SHIPMENT_DATE_FIELDS, SALES_CHANNEL_FIELDS];
  if (parsed.errors.length || !requiredFields.every((aliases) => aliases.some((field) => fields.has(normalizeHeader(field))))) throw new Error("INVALID_FBA_SALES_DOCUMENT");
  const rawRows = parsed.data;
  const columnsDetected = rawRows[0] ? Object.keys(rawRows[0]) : [];
  const normalizedRows = rawRows.map((row) => normalizeAmazonFulfilledShipmentRow(row));
  const skuByRow = normalizedRows.map((row) => getField(row, SKU_FIELDS));
  const matches = await resolveProductMatchesBySku(skuByRow);
  const { data: countryRows, error: countryError } = await supabaseAdmin
    .from("paises")
    .select("code");
  if (countryError) throw new Error(countryError.message);
  const supportedCountries = new Set(
    (countryRows ?? []).map((row) => String(row.code ?? "").trim().toUpperCase()).filter(Boolean),
  );
  const importedAt = new Date().toISOString();
  let matchedRows = 0;
  let unmatchedRows = 0;
  const observedValidMarketplaceIds = new Set<string>();
  const unknownSalesChannels = new Set<string>();

  const dbRows = rawRows.flatMap((sourceRow, index) => {
    const row = normalizedRows[index] ?? normalizeAmazonFulfilledShipmentRow(sourceRow);
    const skuOriginal = skuByRow[index] ?? "";
    const match = matches.get(skuOriginal);
    const saleDate = parseDateOnly(
      firstNonEmpty(
        getField(row, SHIPMENT_DATE_FIELDS),
        getField(row, REPORTING_DATE_FIELDS),
        getField(row, PURCHASE_DATE_FIELDS),
      ),
    );
    const quantity = parseInteger(
      getField(row, QUANTITY_SHIPPED_FIELDS),
    );
    if (!saleDate || !isUtcDateOnly(saleDate) || !skuOriginal || !/^-?\d+$/.test(getField(row, QUANTITY_SHIPPED_FIELDS))) throw new Error("INVALID_FBA_SALES_ROW");
    if (saleDate < params.fromDate || saleDate > params.toDate) throw new Error("FBA_SALES_ROW_OUTSIDE_RANGE");
    // Preserve zero/missing-row semantics pending authoritative identity evidence.
    if (quantity === 0) return [];
    if (match?.productoId) matchedRows += 1;
    else {
      unmatchedRows += 1;
      warnings.push(`Sin match de producto para venta FBA SKU ${skuOriginal}.`);
    }

    const salesChannel = getField(row, SALES_CHANNEL_FIELDS);
    const marketplaceId = observedValidSalesMarketplaceId({
      saleDate,
      sku: skuOriginal,
      quantity,
      salesChannel,
    }) ?? "";
    if (marketplaceId) observedValidMarketplaceIds.add(marketplaceId);
    else unknownSalesChannels.add(salesChannel || "(empty)");
    const amount = parseNumberOrNull(
      getField(row, ITEM_PRICE_FIELDS),
    );
    const currency = firstNonEmpty(
      getField(row, CURRENCY_FIELDS),
      "EUR",
    );
    const shipToCountry = resolveFbaSaleCountry({
      shipCountry: getField(row, SHIP_COUNTRY_FIELDS),
      salesChannel: getField(row, SALES_CHANNEL_FIELDS),
      supportedCountries,
    });
    if (!shipToCountry && process.env.NODE_ENV === "development") {
      console.warn("[amazon-fba-sales-import] missing ship-country in FBA sales row", {
        reportType: params.reportType,
        reportId: params.reportId,
        marketplaceId,
        skuOriginal,
        saleDate,
      });
    }
    const rawSafe = safeRawForSalesReport(params.reportType, row);
    const rowFingerprint = buildFbaSalesNaturalFingerprint({
      row,
      skuOriginal,
      saleDate,
    });

    return [
      {
        report_id: params.reportId,
        marketplace_id: marketplaceId,
        sale_date: saleDate,
        sku_original: skuOriginal,
        sku_limpio: match?.skuLimpio ?? skuOriginal,
        producto_id: match?.productoId ?? null,
        quantity,
        amount,
        currency,
        ship_to_country: shipToCountry || null,
        fulfillment_channel: firstNonEmpty(
          getField(row, FULFILLMENT_CHANNEL_FIELDS),
          "FBA",
        ),
        sales_channel: salesChannel || null,
        row_fingerprint: rowFingerprint,
        raw: {
          ...rawSafe,
          report_type: params.reportType,
          sku_limpio: match?.skuLimpio ?? null,
          match_candidates: match?.candidates ?? [],
          matched_by: match?.matchedBy ?? null,
        },
        imported_at: importedAt,
      },
    ];
  });

  // amazon_fba_sales_daily_raw and sync_ventas_diarias_from_amazon_fba_sales
  // are committed together by the coordinator's fenced PostgreSQL RPC.
  const rowsUpserted = dbRows.length;
  for (const salesChannel of Array.from(unknownSalesChannels)) {
    warnings.push(
      `Sales-channel sin marketplace conocido: ${salesChannel}. La fila se conserva en RAW y se excluye del scope canonical.`,
    );
  }
  const canonicalSyncMarketplaceIds = buildCanonicalSalesMarketplaceScope(
    params.marketplaceIds,
    Array.from(observedValidMarketplaceIds),
  );
  if (canonicalSyncMarketplaceIds.length === 0) {
    throw new Error(
      "No hay marketplaces solicitados u observados validos para sincronizar ventas FBA canonical.",
    );
  }
  const result = await params.commit(dbRows, canonicalSyncMarketplaceIds);
  const ventasDiariasSync: FbaSalesVentasDiariasSyncResult = {
    deletedPreviousRows: Number(result.deleted ?? 0), insertedRows: Number(result.inserted ?? 0),
    insertedUnits: Number(result.units ?? 0), skippedSourceConflicts: Number(result.skippedSourceConflicts ?? 0),
    skippedUnits: 0, orphanRows: Number(result.orphanRows ?? 0), orphanUnits: Number(result.orphanUnits ?? 0),
    marketplaces: (result.marketplaces ?? []) as string[], orphanMarketplaces: (result.orphanMarketplaces ?? []) as string[],
    orphanCountries: (result.orphanCountries ?? []) as string[],
  };
  if (ventasDiariasSync.skippedSourceConflicts > 0) {
    warnings.push(
      "Hay filas FBA cuyo grano ya existe en ventas_diarias con otro source. No se han tocado esas fuentes.",
    );
  }

  return {
    ok: true,
    reportId: params.reportId,
    status: "COMPLETED",
    processingStatus: params.processingStatus,
    amazonReport: params.amazonReport ?? null,
    requestedCreateReportPayload: params.requestedCreateReportPayload,
    rowsParsed: rawRows.length,
    rowsUpserted,
    ventasDiariasUpserted: ventasDiariasSync.insertedRows,
    ventasDiariasSync,
    deletedPreviousRows: ventasDiariasSync.deletedPreviousRows,
    insertedRows: ventasDiariasSync.insertedRows,
    insertedUnits: ventasDiariasSync.insertedUnits,
    skippedSourceConflicts: ventasDiariasSync.skippedSourceConflicts,
    orphanRows: ventasDiariasSync.orphanRows,
    orphanUnits: ventasDiariasSync.orphanUnits,
    matchedRows,
    unmatchedRows,
    warnings: warnings.slice(0, 100),
    columnsDetected,
    diagnosticDocumentExcerpt: params.diagnosticDocumentExcerpt ?? null,
    sampleSanitizedRow: rawRows[0]
      ? normalizeAmazonFulfilledShipmentRow(rawRows[0])
      : null,
  };
}

// Compatibility entry points use the single coordinator; no unfenced sales writer.
export async function importFbaSalesDailyFromSpApi(params: ImportDateRange & { reportType?: SupportedFbaSalesReportType }) {
  return (await import("./fbaSalesSyncCoordinator")).coordinateFbaSalesSync(params);
}
export async function importFbaSalesFromExistingReport(params: ImportDateRange & { reportId: string; reportType?: SupportedFbaSalesReportType }) {
  return (await import("./fbaSalesSyncCoordinator")).coordinateFbaSalesSync(params);
}

type InventorySummary = {
  sellerSku?: string;
  fnSku?: string;
  asin?: string;
  lastUpdatedTime?: string;
  condition?: string;
  totalQuantity?: number;
  inventoryDetails?: {
    fulfillableQuantity?: number;
    reservedQuantity?: {
      totalReservedQuantity?: number;
      pendingCustomerOrderQuantity?: number;
      pendingTransshipmentQuantity?: number;
      fcProcessingQuantity?: number;
    };
    inboundWorkingQuantity?: number;
    inboundShippedQuantity?: number;
    inboundReceivingQuantity?: number;
    unfulfillableQuantity?: {
      totalUnfulfillableQuantity?: number;
    };
    researchingQuantity?: {
      totalResearchingQuantity?: number;
    };
  };
};

type InventorySummariesResponse = {
  payload?: { inventorySummaries?: InventorySummary[] };
  inventorySummaries?: InventorySummary[];
  pagination?: { nextToken?: string };
};

export async function importFbaInventorySnapshotFromSpApi(params: {
  marketplaceIds?: string[];
  sellerSkus?: string[];
  sellerSkuBatchSize?: number;
  maxBatches?: number;
  paginationMode?: "normal" | "diagnostic-stop";
  stopOnNextToken?: boolean;
  /** Read-only acquisition mode for bounded validation; production defaults to persistence. */
  persistSnapshot?: boolean;
  includeObservations?: boolean;
  persistTelemetry?: (row: InventorySummaryRequestTelemetry) => Promise<void>;
  requestFiltered?: typeof requestFilteredInventorySummaries;
  nowMs?: () => number;
  wait?: (ms: number) => Promise<void>;
  random?: () => number;
}): Promise<Omit<ImportSummary, "reportId" | "status"> & {
  observations?: Array<InventorySummary & { marketplaceId: string }>;
  canonicalRows?: ReturnType<typeof buildCanonicalInventorySnapshot>["rows"];
  incompleteObservations?: IncompleteInventoryObservation[];
  publicationSummary?: {
    snapshotRunId: string;
    rawRows: number;
    canonicalPhysicalIdentities: number;
    identityResolvedByAlias: number;
    identityResolvedByAsin: number;
    identityResolvedByLegacySku: number;
    identityIncomplete: number;
    identityAmbiguous: number;
    asinIdentityConflicts: number;
    fnskuIdentityConflicts: number;
    rawFulfillableSum: number;
    dedupedFulfillableSum: number;
    duplicateObservationsRemoved: number;
    duplicateFulfillableUnitsRemoved: number;
    excludedFulfillableUnits: number;
  };
  requestMetrics: {
    marketplacesAttempted: string[];
    marketplacesCompleted: string[];
    pages: number;
    amazonHttpCalls: number;
    requestBudget: number;
    rateLimitedMarketplace: string | null;
    retryAfter: string | null;
    observedRateLimits: string[];
    lastStatus: number | null;
    lastRequestId: string | null;
    nextTokenPresent: boolean | null;
    durationMs: number;
  };
}> {
  const marketplaceIds = marketplaceIdsFromInput(params.marketplaceIds);
  const sellerSkus = normalizedConfirmedSellerSkus(params.sellerSkus ?? []);
  if (sellerSkus.length === 0) {
    throw new Error("FILTERED_INVENTORY_REQUIRES_CONFIRMED_SELLER_SKUS");
  }
  const batchSize = params.sellerSkuBatchSize ?? inventorySummarySellerSkuBatchSize();
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
    throw new Error(`INVALID_INVENTORY_SUMMARY_BATCH_SIZE:${batchSize}`);
  }
  const sellerSkuBatches = splitSellerSkuBatches(sellerSkus, batchSize);
  const maxBatches = params.maxBatches == null ? sellerSkuBatches.length : params.maxBatches;
  if (!Number.isInteger(maxBatches) || maxBatches < 1) {
    throw new Error(`INVALID_INVENTORY_SUMMARY_MAX_BATCHES:${maxBatches}`);
  }
  const batchesToProcess = sellerSkuBatches.slice(0, maxBatches);
  const nowMs = params.nowMs ?? Date.now;
  const wait = params.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const pacer = new InventorySummaryRequestPacer(undefined, nowMs, wait);
  const startedMs = nowMs();
  const warnings: string[] = [];
  const snapshotAt = new Date().toISOString();
  const summaries: Array<InventorySummary & { marketplaceId: string }> = [];
  const maxPagesPerBatch = inventorySummaryMaxPagesPerBatch();
  const configuredRequestBudget = inventorySummaryMaxRequestsPerRun();
  const requestBudget = Math.min(
    configuredRequestBudget,
    Math.max(1, marketplaceIds.length * batchesToProcess.length * maxPagesPerBatch * (1 + MAX_THROTTLE_RESUMES_PER_BATCH)),
  );
  const maxRuntimeMs = inventorySummaryMaxRuntimeMs();
  const marketplacesAttempted: string[] = [];
  const marketplacesCompleted: string[] = [];
  const responseMetadata: SpApiResponseMetadata[] = [];
  let pages = 0;
  let amazonHttpCalls = 0;
  let activeMarketplace: string | null = null;
  const attemptId = newInventoryAttemptId();
  const shouldPersistSnapshot = params.persistSnapshot !== false;
  const persistTelemetry = params.persistTelemetry
    ?? (shouldPersistSnapshot ? persistInventorySummaryRequestTelemetry : async () => undefined);
  const requestFiltered = params.requestFiltered ?? requestFilteredInventorySummaries;
  let requestSequence = 0;
  let lastNextTokenPresent: boolean | null = null;

  const metrics = () => ({
    marketplacesAttempted,
    marketplacesCompleted,
    pages,
    amazonHttpCalls,
    requestBudget,
    rateLimitedMarketplace: activeMarketplace,
    retryAfter: responseMetadata.at(-1)?.retryAfter ?? null,
    observedRateLimits: Array.from(new Set(responseMetadata.map((item) => item.observedRateLimit).filter((value): value is string => Boolean(value)))),
    lastStatus: responseMetadata.at(-1)?.status ?? null,
    lastRequestId: responseMetadata.at(-1)?.requestId ?? null,
    nextTokenPresent: lastNextTokenPresent,
    durationMs: nowMs() - startedMs,
  });

  for (const marketplaceId of marketplaceIds) {
    activeMarketplace = marketplaceId;
    marketplacesAttempted.push(marketplaceId);
    for (const sellerSkuBatch of batchesToProcess) {
      let nextToken: string | undefined;
      let previousNextToken: string | undefined;
      let batchPageNumber = 0;
      do {
      const pageNumber = batchPageNumber + 1;
      let result: InventorySummariesResponse;
      try {
        result = await requestInventorySummaryBatchWithThrottleResume({
          startedAtMs: startedMs,
          maxTotalDurationMs: maxRuntimeMs,
          now: nowMs,
          wait,
          random: params.random,
          observedRateLimit: () => [...responseMetadata].reverse()
            .find((metadata) => metadata.observedRateLimit != null)?.observedRateLimit,
          async request() {
            assertInventorySummaryRuntimeBudget({ startedAtMs: startedMs, nowMs: nowMs(), maxRuntimeMs });
            assertInventorySummaryPageBudget({ pageNumber, maxPagesPerBatch });
            assertInventorySummaryRequestBudget({ amazonHttpCalls, requestBudget });
            const requestStartedAt = new Date().toISOString();
            const requestStartedMs = nowMs();
            const sequence = ++requestSequence;
            let requestOutcome: InventorySummaryRequestTelemetry["outcome"] = "FAILED";
            try {
              amazonHttpCalls += 1;
              const response = await pacer.run(() => requestFiltered({
                marketplaceId,
                sellerSkus: sellerSkuBatch,
                nextToken,
                onResponseMetadata(metadata) {
                  pacer.observeRateLimit(metadata.observedRateLimit);
                  responseMetadata.push(metadata);
                  console.info("[amazon-inventory] response", {
                    marketplaceId,
                    page: pages + 1,
                    status: metadata.status,
                    observedRateLimit: metadata.observedRateLimit,
                    retryAfter: metadata.retryAfter,
                    requestId: metadata.requestId,
                    observedAt: metadata.observedAt,
                  });
                },
              })) as InventorySummariesResponse;
              const rows = response.inventorySummaries ?? response.payload?.inventorySummaries ?? [];
              const nextTokenPresent = Boolean(response.pagination?.nextToken);
              lastNextTokenPresent = nextTokenPresent;
              requestOutcome = nextTokenPresent && params.paginationMode === "diagnostic-stop"
                ? "UNEXPECTED_FILTERED_PAGINATION"
                : "SUCCESS";
              const metadata = responseMetadata.at(-1);
              await persistTelemetry({
                attemptId, requestSequence: sequence, startedAt: requestStartedAt,
                finishedAt: new Date().toISOString(), durationMs: nowMs() - requestStartedMs,
                marketplaceId, operationalPool: inventoryOperationalPool(marketplaceId), batchNumber: sellerSkuBatches.indexOf(sellerSkuBatch) + 1,
                sellerSkuCount: sellerSkuBatch.length, sellerSkusHash: sellerSkusSafeHash(sellerSkuBatch), pageNumber,
                httpStatus: metadata?.status ?? 200, amazonRequestId: metadata?.requestId ?? null,
                observedRateLimit: metadata?.observedRateLimit ?? null, retryAfter: metadata?.retryAfter ?? null,
                nextTokenPresent, resultCount: rows.length, outcome: requestOutcome,
              });
              if (requestOutcome === "UNEXPECTED_FILTERED_PAGINATION") {
                throw new Error("UNEXPECTED_FILTERED_PAGINATION");
              }
              return response;
            } catch (error) {
              const metadata = responseMetadata.at(-1);
              if (requestOutcome === "FAILED") {
                try {
                  await persistTelemetry({
                    attemptId, requestSequence: sequence, startedAt: requestStartedAt,
                    finishedAt: new Date().toISOString(), durationMs: nowMs() - requestStartedMs,
                    marketplaceId, operationalPool: inventoryOperationalPool(marketplaceId), batchNumber: sellerSkuBatches.indexOf(sellerSkuBatch) + 1,
                    sellerSkuCount: sellerSkuBatch.length, sellerSkusHash: sellerSkusSafeHash(sellerSkuBatch), pageNumber,
                    httpStatus: metadata?.status ?? (error instanceof SpApiError ? error.status ?? null : null),
                    amazonRequestId: metadata?.requestId ?? null, observedRateLimit: metadata?.observedRateLimit ?? null,
                    retryAfter: metadata?.retryAfter ?? null, nextTokenPresent: null, resultCount: null,
                    outcome: error instanceof SpApiError && error.code === "rate_limited" ? "RATE_LIMITED" : "FAILED",
                  });
                } catch (telemetryError) {
                  console.error("[amazon-inventory] request telemetry persistence failed", telemetryError);
                }
              }
              throw error;
            }
          },
          onThrottleResume(event) {
            console.warn("[amazon-inventory] controlled throttle resume", {
              marketplaceId,
              batchNumber: sellerSkuBatches.indexOf(sellerSkuBatch) + 1,
              pageNumber,
              ...event,
            });
          },
        }) as InventorySummariesResponse;
      } catch (error) {
        if (error instanceof SpApiError && error.code === "rate_limited") {
          const snapshot = metrics();
          const lastResponse = responseMetadata.at(-1);
          throw new SpApiError(
            `${error.message} [operation=getInventorySummaries marketplace=${marketplaceId} retryAfter=${snapshot.retryAfter ?? "unavailable"} observedLimit=${lastResponse?.observedRateLimit ?? "unavailable"} requestId=${lastResponse?.requestId ?? "unavailable"} calls=${snapshot.amazonHttpCalls}]`,
            error.code,
            error.status,
            { original: error.details, requestMetrics: snapshot },
          );
        }
        throw error;
      }
      pages += 1;
      batchPageNumber += 1;
      const responseRows = result.inventorySummaries ?? result.payload?.inventorySummaries ?? [];
      for (const summary of responseRows) {
        summaries.push({ ...summary, marketplaceId });
      }
      nextToken = result.pagination?.nextToken;
      if (nextToken && params.stopOnNextToken) {
        warnings.push("NEXT_TOKEN_PRESENT_VALIDATION_STOP");
        nextToken = undefined;
      }
      if (nextToken && nextToken === previousNextToken) {
        throw new Error("INVENTORY_SUMMARY_PAGINATION_TOKEN_REPEATED");
      }
      if (nextToken && responseRows.length === 0) {
        throw new Error("INVENTORY_SUMMARY_PAGINATION_NO_PROGRESS");
      }
      previousNextToken = nextToken;
      } while (nextToken);
    }
    marketplacesCompleted.push(marketplaceId);
    activeMarketplace = null;
  }

  const skuValues = summaries.map((s) => ({ sellerSku: s.sellerSku, asin: s.asin }));
  const matches = await resolveProductMatchesBySku(skuValues);
  const matchFor = (summary: InventorySummary) => matches.get(inventoryIdentityKey(String(summary.sellerSku ?? ""), summary.asin));
  const matchedRows = summaries.filter((summary) => matchFor(summary)?.productoId).length;
  const unmatchedRows = summaries.length - matchedRows;
  for (const summary of summaries) {
    const skuOriginal = String(summary.sellerSku ?? "").trim();
    if (!matchFor(summary)?.productoId) {
      warnings.push(`Sin match de producto para snapshot FBA SKU ${skuOriginal}.`);
    }
  }

  // No se escribe hasta que todas las llamadas, paginas y reconciliaciones
  // hayan terminado. La RPC publica el run completo en una sola transaccion.
  const canonical = buildCanonicalInventorySnapshot({
    observations: summaries as InventorySummaryObservation[],
    productMatches: matches,
    observedAt: snapshotAt,
  });
  warnings.push(...canonical.warnings);
  const resolutionCounts = Array.from(matches.values()).reduce((counts, match) => {
    const status = match.resolutionStatus;
    if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const rawFulfillableSum = summaries.reduce(
    (sum, row) => sum + Number(row.inventoryDetails?.fulfillableQuantity ?? 0),
    0,
  );
  const dedupedFulfillableSum = canonical.rows.reduce(
    (sum, row) => sum + row.fulfillable_quantity,
    0,
  );
  const excludedFulfillableUnits = canonical.incompleteObservations.reduce(
    (sum, row) => sum + Number(row.raw.inventoryDetails?.fulfillableQuantity ?? 0),
    0,
  );
  const resolvedRawRows = summaries.length - canonical.incompleteObservations.length;
  const resolvedRawFulfillable = rawFulfillableSum - excludedFulfillableUnits;
  const publicationSummary = {
    snapshotRunId: canonical.snapshotRunId,
    rawRows: summaries.length,
    canonicalPhysicalIdentities: canonical.rows.length,
    identityResolvedByAlias: resolutionCounts.get("IDENTITY_RESOLVED_BY_ALIAS") ?? 0,
    identityResolvedByAsin: resolutionCounts.get("IDENTITY_RESOLVED_BY_ASIN") ?? 0,
    identityResolvedByLegacySku: resolutionCounts.get("IDENTITY_RESOLVED_BY_LEGACY_SKU") ?? 0,
    identityIncomplete: canonical.incompleteObservations.filter((row) => row.status === "IDENTITY_INCOMPLETE").length,
    identityAmbiguous: canonical.incompleteObservations.filter((row) => row.status === "IDENTITY_AMBIGUOUS").length,
    asinIdentityConflicts: canonical.incompleteObservations.filter((row) => row.status === "ASIN_IDENTITY_CONFLICT").length,
    fnskuIdentityConflicts: 0,
    rawFulfillableSum,
    dedupedFulfillableSum,
    duplicateObservationsRemoved: resolvedRawRows - canonical.rows.length,
    duplicateFulfillableUnitsRemoved: resolvedRawFulfillable - dedupedFulfillableSum,
    excludedFulfillableUnits,
  };
  if (!shouldPersistSnapshot) {
    return {
      ok: true,
      rowsParsed: summaries.length,
      rowsUpserted: 0,
      matchedRows,
      unmatchedRows,
      warnings: warnings.slice(0, 100),
      incompleteObservations: canonical.incompleteObservations,
      requestMetrics: metrics(),
      observations: params.includeObservations ? summaries : undefined,
      canonicalRows: params.includeObservations ? canonical.rows : undefined,
      publicationSummary,
    };
  }
  if (publicationSummary.asinIdentityConflicts > 0) {
    throw new Error(`ASIN_IDENTITY_CONFLICT:${publicationSummary.asinIdentityConflicts}`);
  }
  const processedAllSellerSkuBatches = batchesToProcess.length === sellerSkuBatches.length;
  const panEuComplete =
    processedAllSellerSkuBatches &&
    marketplacesCompleted.includes(PAN_EU_REFERENCE_MARKETPLACE_ID);
  const ukComplete =
    processedAllSellerSkuBatches &&
    marketplacesCompleted.includes(UK_REFERENCE_MARKETPLACE_ID);
  const identityConflictCount =
    publicationSummary.asinIdentityConflicts + publicationSummary.fnskuIdentityConflicts;
  const readyForAtomicPublication =
    panEuComplete &&
    ukComplete &&
    identityConflictCount === 0 &&
    marketplaceIds.length === 2 &&
    marketplaceIds.includes(PAN_EU_REFERENCE_MARKETPLACE_ID) &&
    marketplaceIds.includes(UK_REFERENCE_MARKETPLACE_ID);
  if (!readyForAtomicPublication) {
    throw new Error(
      `DUAL_POOL_PUBLICATION_PRECONDITIONS_FAILED:pan_eu=${panEuComplete}:uk=${ukComplete}:conflicts=${identityConflictCount}`,
    );
  }
  console.info("[amazon-inventory] publication preconditions PASS", publicationSummary);
  const { data: committedRows, error: commitError } = await supabaseAdmin.rpc(
    "commit_amazon_fba_inventory_snapshot_run",
    {
      p_run_id: canonical.snapshotRunId,
      p_observed_at: canonical.observedAt,
      p_marketplace_ids: marketplaceIds,
      p_raw_row_count: summaries.length,
      p_rows: canonical.rows,
      p_pan_eu_complete: panEuComplete,
      p_uk_complete: ukComplete,
      p_identity_conflict_count: identityConflictCount,
      p_ready_for_atomic_publication: readyForAtomicPublication,
    },
  );
  if (commitError) throw new Error(commitError.message);
  const rowsUpserted = Number(committedRows ?? canonical.rows.length);

  return {
    ok: true,
    rowsParsed: summaries.length,
    rowsUpserted,
    matchedRows,
    unmatchedRows,
    warnings: warnings.slice(0, 100),
    incompleteObservations: canonical.incompleteObservations,
    publicationSummary,
    requestMetrics: metrics(),
    observations: params.includeObservations ? summaries : undefined,
    canonicalRows: params.includeObservations ? canonical.rows : undefined,
  };
}

async function legacyFbaLedgerDailyFromSpApiDisabled(
  params: ImportDateRange,
): Promise<ImportSummary & { reportId: string }> {
  throw new Error("LEDGER_LEGACY_PATH_DISABLED_USE_CANONICAL_OWNER");
  /* Legacy implementation retained temporarily only as migration history.
  const marketplaceIds = marketplaceIdsFromInput(params.marketplaceIds);
  const warnings: string[] = [];
  const report = await createWaitAndDownloadReport({
    reportType: FBA_LEDGER_REPORT_TYPE,
    marketplaceIds,
    reportOptions: {
      aggregateByLocation: "COUNTRY",
      aggregatedByTimePeriod: "DAILY",
      dataStartTime: toAmazonDateTime(params.fromDate),
      dataEndTime: toAmazonDateTime(params.toDate, true),
    },
  });

  if (!report.documentText && !report.ok) {
    return {
      ok: false,
      reportId: report.reportId,
      status: report.status,
      processingStatus: report.processingStatus,
      requestedCreateReportPayload: report.requestedCreateReportPayload,
      rowsParsed: 0,
      rowsUpserted: 0,
      matchedRows: 0,
      unmatchedRows: 0,
      warnings: [],
      error:
        report.status === "RATE_LIMITED"
          ? "Amazon ha aplicado rate limit al informe ledger. Reintenta mÃ¡s tarde."
          : report.status === "AMAZON_REPORT_FATAL"
            ? "Amazon ha abortado la generacion del informe ledger."
            : "Amazon ha cancelado la generacion del informe ledger.",
    };
  }

  if (!report.documentText) {
    return {
      ok: true,
      reportId: report.reportId,
      status: report.status,
      rowsParsed: 0,
      rowsUpserted: 0,
      matchedRows: 0,
      unmatchedRows: 0,
      warnings: [`Amazon no entregó documento todavía. Estado: ${report.status}.`],
    };
  }

  const commit = await importAmazonFbaLedgerSummaryFromText({
    text: report.documentText,
    mode: "commit",
    source: "spapi_get_ledger_summary_view_data",
    sourceFileName: report.reportId,
    reportDocumentId: report.report?.reportDocumentId ?? null,
    skipUnlinkedProducts: false,
  });
  if (commit.mode !== "commit") {
    throw new Error("Inventory Ledger canonical writer returned preview unexpectedly");
  }

  return {
    ok: true,
    reportId: report.reportId,
    status: report.status,
    rowsParsed: commit.validRows,
    rowsUpserted: commit.insertedOrUpdated,
    matchedRows: commit.validRows - commit.unlinkedProductRows,
    unmatchedRows: commit.unlinkedProductRows,
    warnings: [
      ...warnings,
      ...commit.warnings.map((warning) => `Fila ${warning.row}: ${warning.message}`),
    ].slice(0, 100),
  };
  */
}

void legacyFbaLedgerDailyFromSpApiDisabled;
