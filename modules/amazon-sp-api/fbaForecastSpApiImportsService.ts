import { supabaseAdmin } from "@/server/supabase/adminClient";
import { loadSpApiConfig } from "./config";
import { spApiRequest } from "./spApiClient";
import {
  createWaitAndDownloadReport,
  getField,
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
import { resolveProductMatchesBySku } from "./skuProductMatching";
import {
  resolveFbaSaleCountry,
  salesChannelToMarketplaceId,
} from "./marketplaceMapping";
import type { SpApiReport } from "./types";

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

function countryFromMarketplaceId(marketplaceId: string): string {
  const known: Record<string, string> = {
    A1RKKUPIHCS9HS: "ES",
    A13V1IB3VIYZZH: "FR",
    A1PA6795UKMFR9: "DE",
    APJ6JRA9NG5V4: "IT",
    A1F83G8C2ARO7P: "GB",
    A1C3SOZRARQ6R3: "PL",
    A2NODRKZP88ZB9: "SE",
  };
  return known[marketplaceId] ?? "UNKNOWN";
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

async function syncVentasDiariasFromFbaSalesRaw(params: {
  dateFrom: string;
  dateTo: string;
  marketplaceIds: string[];
}): Promise<FbaSalesVentasDiariasSyncResult> {
  const { data, error } = await supabaseAdmin.rpc(
    "sync_ventas_diarias_from_amazon_fba_sales",
    {
      p_start_date: params.dateFrom,
      p_end_date: addUtcDaysToDateOnly(params.dateTo, 1),
      p_marketplace_ids: params.marketplaceIds.length > 0 ? params.marketplaceIds : null,
      p_tipo_cliente: "B2C",
      p_source: FBA_SALES_SOURCE,
    },
  );

  if (error) throw new Error(error.message);

  const result = (data ?? {}) as Record<string, unknown>;
  const insertedRows = Number(result.inserted ?? 0);
  const insertedUnits = Number(result.units ?? 0);
  const skippedSourceConflicts = Number(result.skippedSourceConflicts ?? 0);

  return {
    deletedPreviousRows: Number(result.deleted ?? 0),
    insertedRows,
    insertedUnits,
    skippedSourceConflicts,
    skippedUnits: 0,
    orphanRows: Number(result.orphanRows ?? 0),
    orphanUnits: Number(result.orphanUnits ?? 0),
    marketplaces: Array.isArray(result.marketplaces)
      ? result.marketplaces.map(String)
      : [],
    orphanMarketplaces: Array.isArray(result.orphanMarketplaces)
      ? result.orphanMarketplaces.map(String)
      : [],
    orphanCountries: Array.isArray(result.orphanCountries)
      ? result.orphanCountries.map(String)
      : [],
  };
}

async function parseAndPersistFbaSalesReportDocument(
  params: PersistFbaSalesReportDocumentParams,
): Promise<ImportSummary & { reportId: string; ventasDiariasUpserted: number }> {
  const warnings = [...(params.warnings ?? [])];
  const rawRows = parseReportRows(params.documentText);
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
    if (!saleDate || !skuOriginal || quantity === 0) return [];
    if (match?.productoId) matchedRows += 1;
    else {
      unmatchedRows += 1;
      warnings.push(`Sin match de producto para venta FBA SKU ${skuOriginal}.`);
    }

    const marketplaceId = firstNonEmpty(
      getField(row, ["marketplace-id", "marketplace id"]),
      salesChannelToMarketplaceId(getField(row, SALES_CHANNEL_FIELDS)) ?? "",
    );
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
        sales_channel: getField(row, SALES_CHANNEL_FIELDS) || null,
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

  const rowsUpserted = await upsertRows(
    "amazon_fba_sales_daily_raw",
    dbRows,
    "row_fingerprint",
  );
  const ventasDiariasSync = await syncVentasDiariasFromFbaSalesRaw({
    dateFrom: params.fromDate,
    dateTo: params.toDate,
    marketplaceIds: params.marketplaceIds,
  });
  if (ventasDiariasSync.skippedSourceConflicts > 0) {
    warnings.push(
      "Hay filas FBA cuyo grano ya existe en ventas_diarias con otro source. No se han tocado esas fuentes.",
    );
  }

  return {
    ok: true,
    reportId: params.reportId,
    status: params.status,
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

export async function importFbaSalesDailyFromSpApi(
  params: ImportDateRange & { reportType?: SupportedFbaSalesReportType },
): Promise<ImportSummary & { reportId: string; ventasDiariasUpserted: number }> {
  const marketplaceIds = marketplaceIdsFromInput(params.marketplaceIds);
  const reportType = params.reportType ?? AMAZON_FULFILLED_SHIPMENTS_REPORT_TYPE;
  const dataStartTime = toAmazonDateTime(params.fromDate);
  const dataEndTime = toAmazonDateTime(params.toDate, true);
  const warnings: string[] = [];
  const report = await createWaitAndDownloadReport({
    reportType,
    marketplaceIds,
    dataStartTime,
    dataEndTime,
  });

  if (!report.documentText && !report.ok) {
    return {
      ok: false,
      reportId: report.reportId,
      status: report.status,
      processingStatus: report.processingStatus,
      amazonReport: report.report,
      requestedCreateReportPayload: report.requestedCreateReportPayload,
      rowsParsed: 0,
      rowsUpserted: 0,
      ventasDiariasUpserted: 0,
      skippedSourceConflicts: 0,
      orphanRows: 0,
      orphanUnits: 0,
      matchedRows: 0,
      unmatchedRows: 0,
      warnings: report.warnings ?? [],
      diagnosticDocumentExcerpt: report.diagnosticDocumentExcerpt ?? null,
      error:
        report.status === "RATE_LIMITED"
          ? "Amazon ha aplicado rate limit al informe. Reintenta mÃ¡s tarde."
          : report.status === "AMAZON_REPORT_FATAL"
          ? "Amazon ha abortado la generacion del informe. Revisa diagnostico del reportId o prueba el informe alternativo."
          : "Amazon ha cancelado la generacion del informe.",
    };
  }

  if (!report.documentText) {
    return {
      ok: report.ok,
      reportId: report.reportId,
      status: report.status,
      processingStatus: report.processingStatus,
      requestedCreateReportPayload: report.requestedCreateReportPayload,
      rowsParsed: 0,
      rowsUpserted: 0,
      ventasDiariasUpserted: 0,
      skippedSourceConflicts: 0,
      orphanRows: 0,
      orphanUnits: 0,
      matchedRows: 0,
      unmatchedRows: 0,
      warnings: [`Amazon no entregó documento todavía. Estado: ${report.status}.`],
    };
  }

  return parseAndPersistFbaSalesReportDocument({
    reportId: report.reportId,
    reportType,
    marketplaceIds,
    fromDate: params.fromDate,
    toDate: params.toDate,
    documentText: report.documentText,
    status: report.status,
    processingStatus: report.processingStatus,
    amazonReport: report.report,
    requestedCreateReportPayload: report.requestedCreateReportPayload,
    warnings,
  });
}

export async function importFbaSalesFromExistingReport(
  params: ImportDateRange & {
    reportId: string;
    reportType?: SupportedFbaSalesReportType;
  },
): Promise<ImportSummary & { reportId: string; ventasDiariasUpserted: number }> {
  const marketplaceIds = marketplaceIdsFromInput(params.marketplaceIds);
  const reportType = params.reportType ?? AMAZON_FULFILLED_SHIPMENTS_REPORT_TYPE;
  const report = await getReport(params.reportId);

  if (report.reportType && report.reportType !== reportType) {
    return {
      ok: false,
      reportId: params.reportId,
      status: "REPORT_TYPE_MISMATCH",
      processingStatus: report.processingStatus,
      amazonReport: report,
      rowsParsed: 0,
      rowsUpserted: 0,
      ventasDiariasUpserted: 0,
      skippedSourceConflicts: 0,
      orphanRows: 0,
      orphanUnits: 0,
      matchedRows: 0,
      unmatchedRows: 0,
      warnings: [],
      error: `El reportId ${params.reportId} es ${report.reportType}, no ${reportType}.`,
    };
  }

  if (report.processingStatus === "CANCELLED") {
    return {
      ok: false,
      reportId: params.reportId,
      status: "AMAZON_REPORT_CANCELLED",
      processingStatus: report.processingStatus,
      amazonReport: report,
      rowsParsed: 0,
      rowsUpserted: 0,
      ventasDiariasUpserted: 0,
      skippedSourceConflicts: 0,
      orphanRows: 0,
      orphanUnits: 0,
      matchedRows: 0,
      unmatchedRows: 0,
      warnings: [],
      error: `Amazon canceló el informe ${params.reportId}.`,
    };
  }

  if (report.processingStatus === "FATAL") {
    const warnings: string[] = [];
    let diagnosticDocumentExcerpt: string | null = null;
    if (report.reportDocumentId) {
      try {
        const document = await getReportDocument(report.reportDocumentId);
        const diagnosticText = await downloadReportDocument(document);
        diagnosticDocumentExcerpt = diagnosticText.slice(0, 4000);
      } catch (error) {
        warnings.push(
          `No se pudo descargar documento diagnostico FATAL: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return {
      ok: false,
      reportId: params.reportId,
      status: "AMAZON_REPORT_FATAL",
      processingStatus: report.processingStatus,
      amazonReport: report,
      rowsParsed: 0,
      rowsUpserted: 0,
      ventasDiariasUpserted: 0,
      skippedSourceConflicts: 0,
      orphanRows: 0,
      orphanUnits: 0,
      matchedRows: 0,
      unmatchedRows: 0,
      warnings,
      diagnosticDocumentExcerpt,
      error: `Amazon marcó el informe ${params.reportId} como FATAL.`,
    };
  }

  if (report.processingStatus !== "DONE" || !report.reportDocumentId) {
    return {
      ok: true,
      reportId: params.reportId,
      status: "PENDING",
      processingStatus: report.processingStatus,
      amazonReport: report,
      rowsParsed: 0,
      rowsUpserted: 0,
      ventasDiariasUpserted: 0,
      skippedSourceConflicts: 0,
      orphanRows: 0,
      orphanUnits: 0,
      matchedRows: 0,
      unmatchedRows: 0,
      warnings: [
        `Amazon no entregó documento todavía. Estado: PENDING (${report.processingStatus}).`,
      ],
    };
  }

  const document = await getReportDocument(report.reportDocumentId);
  const documentText = await downloadReportDocument(document);

  return parseAndPersistFbaSalesReportDocument({
    reportId: params.reportId,
    reportType,
    marketplaceIds,
    fromDate: params.fromDate,
    toDate: params.toDate,
    documentText,
    status: "DONE",
    processingStatus: report.processingStatus,
    amazonReport: report,
  });
}

type InventorySummary = {
  sellerSku?: string;
  fnSku?: string;
  asin?: string;
  condition?: string;
  totalQuantity?: number;
  inventoryDetails?: {
    fulfillableQuantity?: number;
    reservedQuantity?: {
      totalReservedQuantity?: number;
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
  inventorySummaries?: InventorySummary[];
  pagination?: { nextToken?: string };
};

export async function importFbaInventorySnapshotFromSpApi(params: {
  marketplaceIds?: string[];
}): Promise<Omit<ImportSummary, "reportId" | "status">> {
  const marketplaceIds = marketplaceIdsFromInput(params.marketplaceIds);
  const warnings: string[] = [];
  const snapshotAt = new Date().toISOString();
  const summaries: Array<InventorySummary & { marketplaceId: string }> = [];

  for (const marketplaceId of marketplaceIds) {
    let nextToken: string | undefined;
    do {
      const result = await spApiRequest<InventorySummariesResponse>({
        method: "GET",
        path: "/fba/inventory/v1/summaries",
        query: {
          details: "true",
          granularityType: "Marketplace",
          granularityId: marketplaceId,
          marketplaceIds: marketplaceId,
          nextToken,
        },
      });
      for (const summary of result.inventorySummaries ?? []) {
        summaries.push({ ...summary, marketplaceId });
      }
      nextToken = result.pagination?.nextToken;
    } while (nextToken);
  }

  const skuValues = summaries.map((s) => s.sellerSku ?? "");
  const matches = await resolveProductMatchesBySku(skuValues);
  let matchedRows = 0;
  let unmatchedRows = 0;

  const dbRows = summaries.map((summary) => {
    const skuOriginal = String(summary.sellerSku ?? "").trim();
    const match = matches.get(skuOriginal);
    if (match?.productoId) matchedRows += 1;
    else {
      unmatchedRows += 1;
      warnings.push(`Sin match de producto para snapshot FBA SKU ${skuOriginal}.`);
    }
    const details = summary.inventoryDetails ?? {};
    const reserved = Number(details.reservedQuantity?.totalReservedQuantity ?? 0);
    const inbound =
      Number(details.inboundWorkingQuantity ?? 0) +
      Number(details.inboundShippedQuantity ?? 0) +
      Number(details.inboundReceivingQuantity ?? 0);
    const unfulfillable = Number(
      details.unfulfillableQuantity?.totalUnfulfillableQuantity ?? 0,
    );
    const researching = Number(
      details.researchingQuantity?.totalResearchingQuantity ?? 0,
    );

    return {
      snapshot_at: snapshotAt,
      marketplace_id: summary.marketplaceId,
      country: countryFromMarketplaceId(summary.marketplaceId),
      sku_original: skuOriginal,
      sku_limpio: match?.skuLimpio ?? skuOriginal,
      producto_id: match?.productoId ?? null,
      fulfillable_quantity: Number(details.fulfillableQuantity ?? 0),
      reserved_quantity: reserved,
      inbound_quantity: inbound,
      unfulfillable_quantity: unfulfillable,
      researching_quantity: researching,
      source: "spapi_fba_inventory_summaries",
      row_fingerprint: sha256([snapshotAt, summary.marketplaceId, skuOriginal].join("|")),
      raw: summary,
      imported_at: snapshotAt,
    };
  });

  const rowsUpserted = await upsertRows(
    "amazon_fba_inventory_snapshots",
    dbRows,
    "row_fingerprint",
  );

  return {
    ok: true,
    rowsParsed: summaries.length,
    rowsUpserted,
    matchedRows,
    unmatchedRows,
    warnings: warnings.slice(0, 100),
  };
}

export async function importFbaLedgerDailyFromSpApi(
  params: ImportDateRange,
): Promise<ImportSummary & { reportId: string }> {
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

  const rawRows = parseReportRows(report.documentText);
  const skuValues = rawRows.map((row) =>
    firstNonEmpty(getField(row, ["msku", "seller-sku", "sku", "MSKU"])),
  );
  const matches = await resolveProductMatchesBySku(skuValues);
  const importedAt = new Date().toISOString();
  let matchedRows = 0;
  let unmatchedRows = 0;

  const dbRows = rawRows.flatMap((row, index) => {
    const skuOriginal = skuValues[index] ?? "";
    const snapshotDate = parseDateOnly(getField(row, ["date", "snapshot-date"]));
    const match = matches.get(skuOriginal);
    if (!skuOriginal || !snapshotDate) return [];
    if (match?.productoId) matchedRows += 1;
    else {
      unmatchedRows += 1;
      warnings.push(`Sin match de producto para ledger FBA SKU ${skuOriginal}.`);
    }

    const disposition = firstNonEmpty(getField(row, ["disposition"]), "SELLABLE");
    const location = firstNonEmpty(
      getField(row, ["country", "location", "location-country"]),
      countryFromMarketplaceId(marketplaceIds[0] ?? ""),
    );

    return [
      {
        producto_id: match?.productoId ?? null,
        sku_original: skuOriginal,
        sku_limpio: match?.skuLimpio ?? skuOriginal,
        fnsku: firstNonEmpty(getField(row, ["fnsku"])),
        asin: firstNonEmpty(getField(row, ["asin"])),
        title: firstNonEmpty(getField(row, ["title", "product-name"])) || null,
        snapshot_date: snapshotDate,
        disposition,
        starting_warehouse_balance: parseInteger(
          getField(row, ["starting warehouse balance", "starting-balance"]),
        ),
        in_transit_between_warehouses: parseInteger(
          getField(row, ["in transit between warehouses"]),
        ),
        receipts: parseInteger(getField(row, ["receipts", "received"])),
        customer_shipments: parseInteger(
          getField(row, ["customer shipments", "customer-shipments"]),
        ),
        customer_returns: parseInteger(getField(row, ["customer returns"])),
        vendor_returns: parseInteger(getField(row, ["vendor returns"])),
        warehouse_transfer_in_out: parseInteger(
          getField(row, ["warehouse transfer in/out", "warehouse transfer in out"]),
        ),
        found: parseInteger(getField(row, ["found"])),
        lost: parseInteger(getField(row, ["lost"])),
        damaged: parseInteger(getField(row, ["damaged"])),
        disposed: parseInteger(getField(row, ["disposed"])),
        other_events: parseInteger(getField(row, ["other events", "adjustments"])),
        ending_warehouse_balance: parseInteger(
          getField(row, ["ending warehouse balance", "ending-balance"]),
        ),
        unknown_events: parseInteger(getField(row, ["unknown events"])),
        location,
        location_country: location,
        source: "spapi_get_ledger_summary_view_data",
        source_file_name: report.reportId,
        raw: {
          ...row,
          report_id: report.reportId,
          sku_limpio: match?.skuLimpio ?? null,
          match_candidates: match?.candidates ?? [],
          matched_by: match?.matchedBy ?? null,
        },
        updated_at: importedAt,
      },
    ];
  });

  const rowsUpserted = await upsertRows(
    "amazon_fba_inventory_ledger_daily",
    dbRows,
    "sku_original,fnsku,asin,snapshot_date,disposition,location,source",
  );

  return {
    ok: true,
    reportId: report.reportId,
    status: report.status,
    rowsParsed: rawRows.length,
    rowsUpserted,
    matchedRows,
    unmatchedRows,
    warnings: warnings.slice(0, 100),
  };
}
