// modules/amazon-sp-api/allOrdersReportParser.ts
//
// Convierte filas del informe GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL
// en filas de amazon_order_items. Función pura (sin BD ni red) para poder probarla.
// No guarda datos personales (ciudad, código postal, estado).

import { createHash } from "node:crypto";
import { salesChannelToMarketplaceCountry } from "./marketplaceMapping.ts";

export const ALL_ORDERS_REPORT_TYPE = "GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL";

export type AmazonOrderItemRow = {
  producto_id: string | null;
  amazon_order_id: string;
  merchant_order_id: string | null;
  seller_sku: string;
  asin: string;
  purchase_datetime: string;
  purchase_datetime_original: string;
  purchase_date: string;
  last_updated_datetime: string | null;
  order_status: string;
  item_status: string;
  fulfillment_channel: "FBA" | "FBM";
  sales_channel: string | null;
  marketplace_country: string;
  ship_country: string | null;
  quantity: number;
  currency: string | null;
  item_price: number | null;
  item_tax: number | null;
  shipping_price: number | null;
  item_promotion_discount: number | null;
  is_business_order: boolean;
  row_fingerprint: string;
  report_id: string | null;
  fulfillment_channel_original: string;
  amazon_order_item_id: string | null;
  marketplace_classification: "AMAZON" | "NON_AMAZON" | "UNKNOWN";
  purchase_timezone: string;
};

function norm(key: string): string {
  return key.replace(/^﻿/, "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function field(row: Record<string, unknown>, name: string): string {
  return originalField(row,name).trim();
}
function originalField(row: Record<string, unknown>, name: string): string {
  for (const [key, value] of Object.entries(row)) {
    if (norm(key) === name) return String(value ?? "");
  }
  return "";
}

function num(value: string): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

export const MARKETPLACE_TIMEZONES: Readonly<Record<string, string>> = {
  ES: "Europe/Madrid", FR: "Europe/Paris", DE: "Europe/Berlin", IT: "Europe/Rome",
  BE: "Europe/Brussels", NL: "Europe/Amsterdam", SE: "Europe/Stockholm", PL: "Europe/Warsaw",
  GB: "Europe/London", IE: "Europe/Dublin", AE: "Asia/Dubai", SA: "Asia/Riyadh",
};

/** Fecha YYYY-MM-DD de un instante en la zona horaria dada. */
export function localDateInTimeZone(isoDateTime: string, timeZone: string): string | null {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function channelFromReport(value: string): "FBA" | "FBM" {
  const v = value.trim().toLowerCase();
  if (["amazon", "afn", "fba"].includes(v)) return "FBA";
  if (["merchant", "mfn", "fbm"].includes(v)) return "FBM";
  throw new Error(`ALL_ORDERS_UNKNOWN_FULFILLMENT_CHANNEL:${value}`);
}

export function parseAllOrdersRows(
  rows: Array<Record<string, unknown>>,
  options: {
    reportId?: string | null;
    matchProduct?: (sellerSku: string, asin: string) => string | null;
  } = {},
): { rows: AmazonOrderItemRow[]; skipped: number } {
  const byKey = new Map<string, AmazonOrderItemRow>();
  let skipped = 0;

  for (const row of rows) {
    const amazonOrderId = field(row, "amazon-order-id");
    const sellerSku = originalField(row, "sku");
    const purchaseRaw = originalField(row, "purchase-date");
    const quantity = num(field(row, "quantity"));
    if (quantity == null || !Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2147483647) throw new Error("ALL_ORDERS_INVALID_QUANTITY");
    if (!amazonOrderId || !sellerSku.trim() || !purchaseRaw.trim()) {
      skipped += 1;
      continue;
    }
    const purchase = new Date(purchaseRaw);
    if (Number.isNaN(purchase.getTime())) {
      skipped += 1;
      continue;
    }

    const asin = originalField(row, "asin");
    const salesChannel = field(row, "sales-channel") || null;
    const marketplaceCountry = salesChannelToMarketplaceCountry(salesChannel) ?? "UNKNOWN";
    const purchaseIso = purchase.toISOString();
    const timeZone = MARKETPLACE_TIMEZONES[marketplaceCountry] ?? "UTC";
    const purchaseDate = localDateInTimeZone(purchaseIso, timeZone)!;
    const classification = marketplaceCountry !== "UNKNOWN" ? "AMAZON" : /^non-amazon$/i.test(salesChannel ?? "") ? "NON_AMAZON" : "UNKNOWN";
    const lastUpdatedRaw = field(row, "last-updated-date");
    const lastUpdated = lastUpdatedRaw && !Number.isNaN(new Date(lastUpdatedRaw).getTime())
      ? new Date(lastUpdatedRaw).toISOString()
      : null;

    // Retain the existing key contract, including normalized ASIN in the fingerprint only.
    const key = [amazonOrderId, sellerSku.trim(), asin.trim().toUpperCase()].join("|");
    const fingerprint = createHash("sha256").update(`all_orders|${key}`).digest("hex");
    const parsed: AmazonOrderItemRow = {
      producto_id: options.matchProduct?.(sellerSku, asin) ?? null,
      amazon_order_id: amazonOrderId,
      merchant_order_id: field(row, "merchant-order-id") || null,
      seller_sku: sellerSku,
      asin,
      purchase_datetime: purchaseIso,
      purchase_datetime_original: purchaseRaw,
      purchase_date: purchaseDate,
      last_updated_datetime: lastUpdated,
      order_status: originalField(row, "order-status"),
      item_status: originalField(row, "item-status"),
      fulfillment_channel: channelFromReport(field(row, "fulfillment-channel")),
      sales_channel: salesChannel,
      marketplace_country: marketplaceCountry,
      ship_country: field(row, "ship-country").toUpperCase() || null,
      quantity,
      currency: field(row, "currency").toUpperCase() || null,
      item_price: num(field(row, "item-price")),
      item_tax: num(field(row, "item-tax")),
      shipping_price: num(field(row, "shipping-price")),
      item_promotion_discount: num(field(row, "item-promotion-discount")),
      is_business_order: field(row, "is-business-order").toLowerCase() === "true",
      row_fingerprint: fingerprint,
      report_id: options.reportId ?? null,
      fulfillment_channel_original: originalField(row, "fulfillment-channel"),
      amazon_order_item_id: field(row, "order-item-id") || field(row, "amazon-order-item-id") || null,
      marketplace_classification: classification,
      purchase_timezone: timeZone,
    };

    // Misma línea repetida en el fichero (mismo pedido+SKU+ASIN): se suman.
    const previous = byKey.get(key);
    if (previous) {
      if (previous.fulfillment_channel !== parsed.fulfillment_channel || previous.sales_channel !== parsed.sales_channel || previous.purchase_datetime !== parsed.purchase_datetime || previous.order_status !== parsed.order_status || previous.item_status !== parsed.item_status) throw new Error("ALL_ORDERS_DUPLICATE_IDENTITY_CONFLICT");
      // No reliable line ID in older reports: aggregate all consistent physical lines.
      // Reimport replaces the aggregate, never adds it to an existing stored quantity.
      previous.quantity += parsed.quantity;
      if (!Number.isSafeInteger(previous.quantity) || previous.quantity > 2147483647) throw new Error("ALL_ORDERS_INVALID_QUANTITY");
      if (previous.amazon_order_item_id !== parsed.amazon_order_item_id) previous.amazon_order_item_id = null;
      previous.item_price = sumNullable(previous.item_price, parsed.item_price);
      previous.item_tax = sumNullable(previous.item_tax, parsed.item_tax);
      previous.shipping_price = sumNullable(previous.shipping_price, parsed.shipping_price);
      previous.item_promotion_discount = sumNullable(
        previous.item_promotion_discount,
        parsed.item_promotion_discount,
      );
    } else {
      byKey.set(key, parsed);
    }
  }

  return { rows: Array.from(byKey.values()), skipped };
}

/** Estados que no cuentan como venta. */
export function isCancelledOrderItem(orderStatus: string | null | undefined, itemStatus: string | null | undefined): boolean {
  return /cancel/i.test(String(orderStatus ?? "")) || /cancel/i.test(String(itemStatus ?? ""));
}
