import Papa from "papaparse";
import { parseNumber } from "@/modules/imports/shared/parseNumber";
import { extractTwinlySkuFromMsku, isTwinlyMsku } from "@/modules/imports/shared/twinlySku";
import { detectReportTypeFromText } from "./detectReportType";
import {
  buildOrderRowFingerprint,
  computeGrossAmounts,
  computeTaxAmounts,
  isCancelledStatus,
  mapFulfillmentToCanalVenta,
  mapSalesChannelToCountry,
  mapTipoCliente,
} from "./mappers";
import type {
  AmazonAllOrdersParseResult,
  AmazonAllOrdersParseWarning,
  AmazonAllOrdersPreviewSampleRow,
  AmazonAllOrdersRowsByKey,
  AmazonAllOrdersRowsByMonth,
  AmazonAllOrdersUnlinkedSku,
  ParsedAmazonAllOrdersRow,
} from "./types";

type RawRow = Record<string, unknown>;

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function getValue(row: RawRow, possibleNames: string[]): string {
  const normalizedMap = new Map<string, string>();
  for (const key of Object.keys(row)) {
    normalizedMap.set(normalizeHeader(key), key);
  }
  for (const name of possibleNames) {
    const realKey = normalizedMap.get(normalizeHeader(name));
    if (realKey) return cleanText(row[realKey]);
  }
  return "";
}

function parseInteger(value: unknown): number {
  const raw = cleanText(value);
  if (!raw) return 0;
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function parseBoolean(value: unknown): boolean {
  const raw = cleanText(value).toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "y";
}

function parseIsoDatetime(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parsePurchaseDate(value: string): string | null {
  const iso = parseIsoDatetime(value);
  if (iso) return iso.slice(0, 10);
  const onlyDate = value.split(/[ T]/)[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(onlyDate)) return onlyDate;
  return null;
}

function rowToRecord(row: RawRow): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value;
  }
  return out;
}

export async function parseAmazonAllOrdersFile(
  file: File,
): Promise<AmazonAllOrdersParseResult> {
  const text = await file.text();
  const { delimiter } = detectReportTypeFromText(text);

  const parsed = await new Promise<Papa.ParseResult<RawRow>>((resolve, reject) => {
    Papa.parse<RawRow>(text, {
      header: true,
      skipEmptyLines: "greedy",
      delimiter,
      complete: resolve,
      error: reject,
    });
  });

  const warnings: AmazonAllOrdersParseWarning[] = [];
  const validRows: ParsedAmazonAllOrdersRow[] = [];

  let totalRows = 0;
  let twinlyRows = 0;
  let skippedNonTwinlyRows = 0;
  let skippedCancelledRows = 0;
  let skippedQuantityZeroRows = 0;
  let skippedRows = 0;

  for (let i = 0; i < (parsed.data ?? []).length; i++) {
    const row = parsed.data[i];
    const rowNumber = i + 2;

    if (!row || Object.keys(row).length === 0) continue;
    const hasContent = Object.values(row).some((v) => cleanText(v) !== "");
    if (!hasContent) continue;

    totalRows++;

    const skuOriginal = getValue(row, ["sku", "seller-sku", "SKU"]);
    if (!skuOriginal) {
      skippedRows++;
      continue;
    }

    if (!isTwinlyMsku(skuOriginal)) {
      skippedNonTwinlyRows++;
      continue;
    }

    twinlyRows++;

    const skuLimpio = extractTwinlySkuFromMsku(skuOriginal);
    if (!skuLimpio) {
      skippedRows++;
      continue;
    }

    const orderStatus = getValue(row, ["order-status", "order status"]);
    const itemStatus = getValue(row, ["item-status", "item status"]);
    if (isCancelledStatus(orderStatus) || isCancelledStatus(itemStatus)) {
      skippedCancelledRows++;
      continue;
    }

    const quantity = parseInteger(getValue(row, ["quantity"]));
    if (quantity <= 0) {
      skippedQuantityZeroRows++;
      continue;
    }

    const purchaseDateRaw = getValue(row, ["purchase-date", "purchase date"]);
    const purchaseDatetime = parseIsoDatetime(purchaseDateRaw);
    const purchaseDate = parsePurchaseDate(purchaseDateRaw);
    if (!purchaseDatetime || !purchaseDate) {
      skippedRows++;
      warnings.push({
        row: rowNumber,
        message: `Fecha de compra no válida: "${purchaseDateRaw}"`,
      });
      continue;
    }

    const salesChannel = getValue(row, ["sales-channel", "sales channel"]);
    const fulfillmentChannel = getValue(row, [
      "fulfillment-channel",
      "fulfillment channel",
    ]);
    const canalVenta = mapFulfillmentToCanalVenta(fulfillmentChannel);
    let marketplaceCountry = mapSalesChannelToCountry(salesChannel);
    const shipCountry = getValue(row, ["ship-country", "ship country"]).toUpperCase();
    if (
      (marketplaceCountry === "UNKNOWN" || !marketplaceCountry) &&
      shipCountry &&
      shipCountry.length === 2
    ) {
      marketplaceCountry = shipCountry === "UK" ? "GB" : shipCountry;
    }
    const isBusinessOrder = parseBoolean(
      getValue(row, ["is-business-order", "is business order"]),
    );

    const itemPrice = parseNumber(getValue(row, ["item-price", "item price"]));
    const itemTax = parseNumber(getValue(row, ["item-tax", "item tax"]));
    const shippingPrice = parseNumber(
      getValue(row, ["shipping-price", "shipping price"]),
    );
    const shippingTax = parseNumber(
      getValue(row, ["shipping-tax", "shipping tax"]),
    );
    const giftWrapPrice = parseNumber(
      getValue(row, ["gift-wrap-price", "gift wrap price"]),
    );
    const giftWrapTax = parseNumber(
      getValue(row, ["gift-wrap-tax", "gift wrap tax"]),
    );
    const itemPromotionDiscount = parseNumber(
      getValue(row, ["item-promotion-discount", "item promotion discount"]),
    );
    const shipPromotionDiscount = parseNumber(
      getValue(row, ["ship-promotion-discount", "ship promotion discount"]),
    );

    const amazonOrderId = getValue(row, ["amazon-order-id", "amazon order id"]);
    const orderItemId = getValue(row, ["order-item-id", "order item id"]);
    const asin = getValue(row, ["asin", "ASIN"]);

    const gross = computeGrossAmounts({
      itemPrice,
      shippingPrice,
      giftWrapPrice,
      itemPromotionDiscount,
      shipPromotionDiscount,
    });
    const tax = computeTaxAmounts({ itemTax, shippingTax, giftWrapTax });

    const currency = getValue(row, ["currency"]).toUpperCase() || "EUR";

    const lastUpdatedRaw = getValue(row, [
      "last-updated-date",
      "last updated date",
    ]);

    validRows.push({
      rowNumber,
      amazonOrderId,
      merchantOrderId: getValue(row, ["merchant-order-id", "merchant order id"]),
      orderItemId,
      purchaseDatetime,
      purchaseDate,
      lastUpdatedDatetime: parseIsoDatetime(lastUpdatedRaw),
      orderStatus,
      itemStatus,
      fulfillmentChannel,
      salesChannel,
      marketplaceCountry,
      shipCountry,
      skuOriginal,
      skuLimpio,
      asin,
      productName: getValue(row, ["product-name", "product name"]) || null,
      quantity,
      currency,
      itemPrice,
      itemTax,
      shippingPrice,
      shippingTax,
      giftWrapPrice,
      giftWrapTax,
      itemPromotionDiscount,
      shipPromotionDiscount,
      isBusinessOrder,
      canalVenta,
      tipoCliente: mapTipoCliente(isBusinessOrder),
      gross,
      tax,
      rowFingerprint: buildOrderRowFingerprint({
        orderItemId,
        amazonOrderId,
        skuOriginal,
        asin,
        purchaseDateRaw,
        quantity,
        itemPrice,
      }),
      raw: rowToRecord(row),
    });
  }

  return {
    totalRows,
    twinlyRows,
    skippedNonTwinlyRows,
    skippedCancelledRows,
    skippedQuantityZeroRows,
    skippedRows,
    validRows,
    warnings: warnings.slice(0, 200),
  };
}

export function summarizeAllOrdersRows(rows: ParsedAmazonAllOrdersRow[]) {
  const skuSet = new Set<string>();
  let dateMin: string | null = null;
  let dateMax: string | null = null;

  for (const row of rows) {
    skuSet.add(row.skuLimpio);
    if (!dateMin || row.purchaseDate < dateMin) dateMin = row.purchaseDate;
    if (!dateMax || row.purchaseDate > dateMax) dateMax = row.purchaseDate;
  }

  return {
    uniqueSkus: skuSet.size,
    dateRange: { from: dateMin, to: dateMax },
  };
}

export function summarizeRowsByMonth(rows: ParsedAmazonAllOrdersRow[]) {
  const byMonth = new Map<string, { rows: number; skus: Set<string> }>();
  for (const row of rows) {
    const month = row.purchaseDate.slice(0, 7);
    const entry = byMonth.get(month) ?? { rows: 0, skus: new Set<string>() };
    entry.rows++;
    entry.skus.add(row.skuLimpio);
    byMonth.set(month, entry);
  }
  return Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { rows, skus }]) => ({
      month,
      rows,
      uniqueSkus: skus.size,
    })) satisfies AmazonAllOrdersRowsByMonth[];
}

export function summarizeRowsByKey(
  rows: ParsedAmazonAllOrdersRow[],
  pick: (row: ParsedAmazonAllOrdersRow) => string,
): AmazonAllOrdersRowsByKey[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = pick(row) || "UNKNOWN";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([key, rowCount]) => ({ key, rows: rowCount }))
    .sort((a, b) => b.rows - a.rows);
}

export function summarizeUnlinkedSkus(
  rows: ParsedAmazonAllOrdersRow[],
  productoBySku: Map<string, string>,
) {
  const counts = new Map<string, number>();
  let skippedUnlinkedRows = 0;

  for (const row of rows) {
    if (productoBySku.get(row.skuLimpio)) continue;
    skippedUnlinkedRows++;
    counts.set(row.skuLimpio, (counts.get(row.skuLimpio) ?? 0) + 1);
  }

  const unlinkedSkus = Array.from(counts.entries())
    .map(([skuLimpio, rowCount]) => ({ skuLimpio, rows: rowCount }))
    .sort((a, b) => b.rows - a.rows) satisfies AmazonAllOrdersUnlinkedSku[];

  return { skippedUnlinkedRows, unlinkedSkus };
}

function toPreviewSampleRow(
  row: ParsedAmazonAllOrdersRow,
  productoBySku: Map<string, string>,
): AmazonAllOrdersPreviewSampleRow {
  return {
    purchaseDate: row.purchaseDate,
    skuOriginal: row.skuOriginal,
    skuLimpio: row.skuLimpio,
    asin: row.asin || null,
    productLinked: Boolean(productoBySku.get(row.skuLimpio)),
    orderStatus: row.orderStatus || null,
    itemStatus: row.itemStatus || null,
    quantity: row.quantity,
    itemPrice: row.itemPrice,
    itemTax: row.itemTax,
    salesChannel: row.salesChannel || null,
    marketplaceCountry: row.marketplaceCountry,
    shipCountry: row.shipCountry || null,
    canalVenta: row.canalVenta,
  };
}

export function toPreviewSampleRows(
  rows: ParsedAmazonAllOrdersRow[],
  productoBySku: Map<string, string>,
  limit = 20,
): AmazonAllOrdersPreviewSampleRow[] {
  if (rows.length === 0) return [];
  if (rows.length <= limit) {
    return rows.map((row) => toPreviewSampleRow(row, productoBySku));
  }

  const byDate = new Map<string, ParsedAmazonAllOrdersRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.purchaseDate) ?? [];
    list.push(row);
    byDate.set(row.purchaseDate, list);
  }

  const sortedDates = Array.from(byDate.keys()).sort();
  const minDate = sortedDates[0];
  const maxDate = sortedDates[sortedDates.length - 1];
  const midDate = sortedDates[Math.floor(sortedDates.length / 2)];

  const picked: ParsedAmazonAllOrdersRow[] = [];
  const seen = new Set<string>();

  function pickFromDate(date: string, maxCount: number) {
    for (const row of byDate.get(date) ?? []) {
      if (picked.length >= limit || maxCount <= 0) break;
      const key = row.rowFingerprint;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(row);
      maxCount--;
    }
  }

  pickFromDate(minDate, 5);
  if (midDate !== minDate) pickFromDate(midDate, 5);
  if (maxDate !== minDate && maxDate !== midDate) pickFromDate(maxDate, 5);

  if (picked.length < limit) {
    for (const date of sortedDates) {
      pickFromDate(date, limit - picked.length);
      if (picked.length >= limit) break;
    }
  }

  return picked.map((row) => toPreviewSampleRow(row, productoBySku));
}
