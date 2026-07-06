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
import { resolveProductMatchesBySku } from "./skuProductMatching";
import type { SpApiReport } from "./types";

const FBA_SALES_REPORT_TYPE = "GET_FBA_FULFILLMENT_CUSTOMER_SHIPMENT_SALES_DATA";
const AMAZON_FULFILLED_SHIPMENTS_REPORT_TYPE =
  "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL";
const FBA_LEDGER_REPORT_TYPE = "GET_LEDGER_SUMMARY_VIEW_DATA";
const BATCH_SIZE = 200;

export const SUPPORTED_FBA_SALES_REPORT_TYPES = [
  FBA_SALES_REPORT_TYPE,
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
  matchedRows: number;
  unmatchedRows: number;
  warnings: string[];
  error?: string;
  columnsDetected?: string[];
  diagnosticDocumentExcerpt?: string | null;
  sampleSanitizedRow?: Record<string, unknown> | null;
};

function marketplaceIdsFromInput(marketplaceIds?: string[]): string[] {
  const fromInput = (marketplaceIds ?? []).map((v) => v.trim()).filter(Boolean);
  if (fromInput.length > 0) return Array.from(new Set(fromInput));
  return loadSpApiConfig().marketplaceIds;
}

function toAmazonDateTime(date: string, endOfDay = false): string {
  return `${date}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
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
  "shipment-date",
  "reporting-date",
  "sku",
  "fnsku",
  "asin",
  "product-name",
  "quantity",
  "quantity-shipped",
  "currency",
  "item-price",
  "item-price-per-unit",
  "shipping-price",
  "ship-country",
  "fulfillment-center-id",
  "fulfillment-channel",
  "sales-channel",
];

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

function safeRawForSalesReport(
  reportType: SupportedFbaSalesReportType,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return sanitizeAmazonFulfilledShipmentRow(row);
}

function fbaSalesSourceForReportType(reportType: string | null | undefined): string {
  return reportType === AMAZON_FULFILLED_SHIPMENTS_REPORT_TYPE
    ? "spapi_amazon_fulfilled_shipments"
    : "spapi_fba_customer_shipment_sales";
}

function buildFbaSalesNaturalFingerprint(params: {
  reportType: SupportedFbaSalesReportType;
  marketplaceId: string;
  row: Record<string, unknown>;
  skuOriginal: string;
  saleDate: string;
  quantity: number;
  amount: number | null;
  shipToCountry: string;
}): string {
  const amazonOrderId = getField(params.row, ["amazon-order-id", "amazon order id"]);
  const shipmentId = getField(params.row, ["shipment-id", "shipment id"]);
  const shipmentItemId = getField(params.row, ["shipment-item-id", "shipment item id"]);
  const productName = getField(params.row, ["product-name", "product name", "title"]);
  const hasAmazonIds = Boolean(amazonOrderId || shipmentId || shipmentItemId);

  const parts = hasAmazonIds
    ? [
        params.reportType,
        params.marketplaceId,
        amazonOrderId,
        shipmentId,
        shipmentItemId,
        params.skuOriginal,
        params.saleDate,
        String(params.quantity),
        String(params.amount ?? ""),
        params.shipToCountry,
      ]
    : [
        params.reportType,
        params.marketplaceId,
        params.skuOriginal,
        params.saleDate,
        String(params.quantity),
        String(params.amount ?? ""),
        params.shipToCountry,
        productName,
      ];

  return sha256(parts.join("|"));
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
}): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("amazon_fba_sales_daily_raw")
    .select(
      "producto_id, sale_date, ship_to_country, currency, marketplace_id, quantity, amount, raw",
    )
    .not("producto_id", "is", null)
    .gte("sale_date", params.dateFrom)
    .lte("sale_date", params.dateTo);

  if (error) throw new Error(error.message);

  const grouped = new Map<string, Record<string, unknown> & {
    unidades_vendidas: number;
    ingresos_brutos: number;
    sources: Set<string>;
  }>();

  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const raw = (r.raw && typeof r.raw === "object" ? r.raw : {}) as Record<string, unknown>;
    const source = fbaSalesSourceForReportType(String(raw.report_type ?? ""));
    const pais = String(r.ship_to_country ?? "UNKNOWN") || "UNKNOWN";
    const moneda = String(r.currency ?? "EUR") || "EUR";
    const marketplaceId = String(r.marketplace_id ?? "");
    const key = [
      r.producto_id,
      r.sale_date,
      pais,
      "FBA",
      moneda,
      "B2C",
      marketplaceId,
    ].join("|");
    const current =
      grouped.get(key) ??
      ({
        producto_id: r.producto_id,
        fecha: r.sale_date,
        pais,
        canal_venta: "FBA",
        moneda,
        tipo_cliente: "B2C",
        marketplace_id: marketplaceId,
        source,
        unidades_vendidas: 0,
        ingresos_brutos: 0,
        sources: new Set<string>(),
      } as Record<string, unknown> & {
        unidades_vendidas: number;
        ingresos_brutos: number;
        sources: Set<string>;
      });

    current.unidades_vendidas += Number(r.quantity ?? 0);
    current.ingresos_brutos += Number(r.amount ?? 0);
    current.sources.add(source);
    current.source =
      current.sources.size === 1
        ? Array.from(current.sources)[0]
        : "spapi_mixed_fba_reports";
    grouped.set(key, current);
  }

  const ventasRows = Array.from(grouped.values()).map((r) => {
    const ingresosBrutos = Number(r.ingresos_brutos ?? 0);
    return {
      producto_id: r.producto_id,
      fecha: r.fecha,
      pais: r.pais ?? "UNKNOWN",
      canal_venta: "FBA",
      moneda: r.moneda ?? "EUR",
      tipo_cliente: "B2C",
      marketplace_id: r.marketplace_id ?? "",
      unidades_vendidas: Number(r.unidades_vendidas ?? 0),
      ingresos_brutos: ingresosBrutos,
      publicidad_gasto_ads: 0,
      iva_pagado_cuota: 0,
      ingresos_netos_sin_iva: ingresosBrutos,
      comisiones_amazon_referral: 0,
      comisiones_amazon_fba: 0,
      coste_devoluciones: 0,
      source: r.source,
    };
  });

  if (ventasRows.length === 0) return 0;

  return upsertRows(
    "ventas_diarias",
    ventasRows,
    "producto_id,fecha,pais,canal_venta,moneda,tipo_cliente,marketplace_id",
  );
}

export async function importFbaSalesDailyFromSpApi(
  params: ImportDateRange & { reportType?: SupportedFbaSalesReportType },
): Promise<ImportSummary & { reportId: string; ventasDiariasUpserted: number }> {
  const marketplaceIds = marketplaceIdsFromInput(params.marketplaceIds);
  const reportType = params.reportType ?? FBA_SALES_REPORT_TYPE;
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
      matchedRows: 0,
      unmatchedRows: 0,
      warnings: [`Amazon no entregó documento todavía. Estado: ${report.status}.`],
    };
  }

  const rawRows = parseReportRows(report.documentText);
  const columnsDetected = rawRows[0] ? Object.keys(rawRows[0]) : [];
  const skuByRow = rawRows.map((row) =>
    firstNonEmpty(
      getField(row, ["seller-sku", "sku", "msku"]),
      getField(row, ["Seller SKU", "SKU", "MSKU"]),
    ),
  );
  const matches = await resolveProductMatchesBySku(skuByRow);
  const importedAt = new Date().toISOString();
  let matchedRows = 0;
  let unmatchedRows = 0;

  const dbRows = rawRows.flatMap((row, index) => {
    const skuOriginal = skuByRow[index] ?? "";
    const match = matches.get(skuOriginal);
    const saleDate = parseDateOnly(
      firstNonEmpty(
        getField(row, [
          "shipment-date",
          "shipment date",
          "reporting-date",
          "purchase-date",
          "posted-date",
          "date",
        ]),
        getField(row, ["Shipment Date", "Reporting Date", "Purchase Date", "Date"]),
      ),
    );
    const quantity = parseInteger(
      firstNonEmpty(
        getField(row, ["quantity-shipped", "quantity", "qty"]),
        getField(row, ["Quantity Shipped", "Quantity"]),
      ),
    );
    if (!saleDate || !skuOriginal || quantity === 0) return [];
    if (match?.productoId) matchedRows += 1;
    else {
      unmatchedRows += 1;
      warnings.push(`Sin match de producto para venta FBA SKU ${skuOriginal}.`);
    }

    const marketplaceId = firstNonEmpty(
      getField(row, ["marketplace-id", "marketplace id"]),
      marketplaceIds[0] ?? "",
    );
    const amount = parseNumberOrNull(
      firstNonEmpty(
        getField(row, ["item-price", "amount", "principal", "sales"]),
        getField(row, ["Item Price", "Amount", "Sales"]),
      ),
    );
    const currency = firstNonEmpty(
      getField(row, ["currency", "currency-code", "currency code"]),
      "EUR",
    );
    const shipToCountry = firstNonEmpty(
      getField(row, ["ship-to-country", "ship country", "country"]),
      getField(row, ["ship-country"]),
      countryFromMarketplaceId(marketplaceId),
    );
    const rawSafe = safeRawForSalesReport(reportType, row);
    const rowFingerprint = buildFbaSalesNaturalFingerprint({
      reportType,
      marketplaceId,
      row,
      skuOriginal,
      saleDate,
      quantity,
      amount,
      shipToCountry,
    });

    return [
      {
        report_id: report.reportId,
        marketplace_id: marketplaceId,
        sale_date: saleDate,
        sku_original: skuOriginal,
        sku_limpio: match?.skuLimpio ?? skuOriginal,
        producto_id: match?.productoId ?? null,
        quantity,
        amount,
        currency,
        ship_to_country: shipToCountry,
        fulfillment_channel: "FBA",
        sales_channel: firstNonEmpty(getField(row, ["sales-channel", "sales channel"])),
        row_fingerprint: rowFingerprint,
        raw: {
          ...rawSafe,
          report_type: reportType,
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
  const ventasDiariasUpserted = await syncVentasDiariasFromFbaSalesRaw({
    dateFrom: params.fromDate,
    dateTo: params.toDate,
  });

  return {
    ok: true,
    reportId: report.reportId,
    status: report.status,
    processingStatus: report.processingStatus,
    amazonReport: report.report,
    requestedCreateReportPayload: report.requestedCreateReportPayload,
    rowsParsed: rawRows.length,
    rowsUpserted,
    ventasDiariasUpserted,
    matchedRows,
    unmatchedRows,
    warnings: warnings.slice(0, 100),
    columnsDetected,
    sampleSanitizedRow: rawRows[0]
      ? sanitizeAmazonFulfilledShipmentRow(rawRows[0])
      : null,
  };
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
