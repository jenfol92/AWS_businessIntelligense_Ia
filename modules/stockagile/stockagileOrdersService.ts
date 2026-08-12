import { randomUUID } from "crypto";

import { extractTwinlySkuFromSellerSku } from "@/modules/imports/shared/twinlySku";

import { fetchStockagileOrderLines } from "./stockagileClient";
import {
  resolveProductIdsByTwinlyEan,
  syncVentasDiariasFromStockagileFbmSales,
  upsertStockagileRawRows,
} from "./stockagileOrdersRepository";
import {
  STOCKAGILE_FBM_SOURCE,
  type StockagileImportSummary,
  type StockagileOrderLineInput,
  type StockagileRawDbRow,
  type StockagileSyncSummary,
} from "./stockagileTypes";

function cleanText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function parseInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.trunc(parsed);
}

function parseNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseNullablePositiveNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function normalizeDedupePart(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[|]/g, "/");
}

function buildDedupeKey(params: {
  source: string;
  externalOrderId: string;
  externalOrderLineId: string | null;
  skuLimpio: string | null;
  eanTwinly: string | null;
  skuOriginal: string | null;
  orderDate: string;
}): string {
  const skuPart =
    normalizeDedupePart(params.skuLimpio) ||
    normalizeDedupePart(params.eanTwinly) ||
    normalizeDedupePart(params.skuOriginal) ||
    "NO_SKU";

  return [
    normalizeDedupePart(params.source),
    normalizeDedupePart(params.externalOrderId) || "NO_ORDER",
    normalizeDedupePart(params.externalOrderLineId) || "NO_LINE",
    skuPart,
    normalizeDedupePart(params.orderDate),
  ].join("|");
}

function resolveUnitPrice(line: StockagileOrderLineInput, quantity: number, grossAmount: number): number | null {
  const explicit = parseNullablePositiveNumber(line.unitPrice);
  if (explicit != null) return explicit;
  if (quantity > 0 && Number.isFinite(grossAmount) && grossAmount > 0) {
    return grossAmount / quantity;
  }
  return null;
}

function defaultCountry(): string {
  return process.env.STOCKAGILE_DEFAULT_COUNTRY?.trim() || "ES";
}

function defaultCurrency(): string {
  return process.env.STOCKAGILE_DEFAULT_CURRENCY?.trim() || "EUR";
}

export async function mapStockagileLinesToRawRows(params: {
  lines: StockagileOrderLineInput[];
  importBatchId: string;
  source?: string;
}): Promise<StockagileRawDbRow[]> {
  const source = params.source?.trim() || STOCKAGILE_FBM_SOURCE;
  const now = new Date().toISOString();
  const eans = params.lines
    .map((line) => extractTwinlySkuFromSellerSku(line.skuOriginal ?? ""))
    .filter((ean): ean is string => Boolean(ean));
  const productByEan = await resolveProductIdsByTwinlyEan(eans);

  return params.lines.map((line) => {
    const skuOriginal = cleanText(line.skuOriginal);
    const eanTwinly = extractTwinlySkuFromSellerSku(skuOriginal ?? "");
    const externalOrderId = cleanText(line.externalOrderId) ?? "";
    const externalOrderLineId = cleanText(line.externalOrderLineId);
    const orderDate = dateOnly(line.orderDate);
    const quantity = parseInteger(line.quantity);
    const grossAmount = parseNumber(line.grossAmount);
    const unitPrice = resolveUnitPrice(line, quantity, grossAmount);
    const productoId = eanTwinly ? productByEan.get(eanTwinly) ?? null : null;
    const isTwinly = Boolean(eanTwinly);
    const omitReason = !isTwinly ? "NON_TWINLY" : productoId ? null : "PRODUCT_NOT_FOUND";
    const dedupeKey = buildDedupeKey({
      source,
      externalOrderId,
      externalOrderLineId,
      skuLimpio: eanTwinly,
      eanTwinly,
      skuOriginal,
      orderDate,
    });

    return {
      import_batch_id: params.importBatchId,
      source,
      dedupe_key: dedupeKey,
      external_order_id: externalOrderId,
      external_order_line_id: externalOrderLineId,
      order_date: orderDate,
      order_datetime: cleanText(line.orderDatetime),
      sales_channel: cleanText(line.salesChannel),
      marketplace: cleanText(line.marketplace),
      fulfillment_type: cleanText(line.fulfillmentType),
      country: cleanText(line.country) ?? defaultCountry(),
      currency: cleanText(line.currency) ?? defaultCurrency(),
      order_status: cleanText(line.orderStatus),
      sku_original: skuOriginal,
      sku_limpio: eanTwinly,
      ean_twinly: eanTwinly,
      is_twinly: isTwinly,
      omit_reason: omitReason,
      quantity,
      gross_amount: grossAmount,
      unit_price: unitPrice,
      producto_id: productoId,
      raw: line.raw ?? (line as unknown as Record<string, unknown>),
      updated_at: now,
    };
  });
}

export async function importStockagileOrderLines(params: {
  lines: StockagileOrderLineInput[];
  source?: string;
}): Promise<StockagileImportSummary> {
  const importBatchId = randomUUID();
  const rows = await mapStockagileLinesToRawRows({
    lines: params.lines,
    importBatchId,
    source: params.source,
  });
  const rawRowsUpserted = await upsertStockagileRawRows(rows);

  return {
    importBatchId,
    rawRowsUpserted,
    parsedLines: rows.length,
    twinlyLines: rows.filter((row) => row.is_twinly).length,
    nonTwinlyLines: rows.filter((row) => row.omit_reason === "NON_TWINLY").length,
    productNotFoundLines: rows.filter((row) => row.omit_reason === "PRODUCT_NOT_FOUND").length,
  };
}

export async function fetchAndImportStockagileOrders(params: {
  startDate: string;
  endDate: string;
  source?: string;
  ordersPath?: string | null;
}): Promise<StockagileImportSummary> {
  const lines = await fetchStockagileOrderLines({
    startDate: params.startDate,
    endDate: params.endDate,
    path: params.ordersPath,
  });

  return importStockagileOrderLines({
    lines,
    source: params.source,
  });
}

export async function syncStockagileFbmSales(params: {
  startDate: string;
  endDate: string;
  source?: string;
  tipoCliente?: string;
}): Promise<StockagileSyncSummary> {
  return syncVentasDiariasFromStockagileFbmSales({
    startDate: params.startDate,
    endDate: params.endDate,
    source: params.source?.trim() || STOCKAGILE_FBM_SOURCE,
    tipoCliente: params.tipoCliente?.trim() || "B2C",
  });
}
