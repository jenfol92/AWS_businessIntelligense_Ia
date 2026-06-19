import { createHash } from "crypto";

const SALES_CHANNEL_TO_COUNTRY: Record<string, string> = {
  "amazon.es": "ES",
  "amazon.fr": "FR",
  "amazon.de": "DE",
  "amazon.it": "IT",
  "amazon.co.uk": "GB",
  "amazon.nl": "NL",
  "amazon.pl": "PL",
  "amazon.se": "SE",
  "amazon.com.be": "BE",
};

export function mapSalesChannelToCountry(salesChannel: string): string {
  const key = salesChannel.trim().toLowerCase();
  if (!key) return "UNKNOWN";
  return SALES_CHANNEL_TO_COUNTRY[key] ?? "UNKNOWN";
}

export function mapFulfillmentToCanalVenta(fulfillmentChannel: string): string {
  const v = fulfillmentChannel.trim().toUpperCase();
  if (!v) return "AMAZON";
  if (
    v === "AMAZON" ||
    v === "FBA" ||
    v.includes("AFN") ||
    v.includes("FBA")
  ) {
    return "AMAZON_FBA";
  }
  if (v === "MERCHANT" || v.includes("MFN") || v.includes("FBM")) return "FBM";
  return "AMAZON";
}

/** ventas_diarias usa FBA/FBM (compatible con forecast/inventario). */
export function mapCanalVentaToVentasDiarias(canalVenta: string): string {
  if (canalVenta === "AMAZON_FBA") return "FBA";
  if (canalVenta === "FBM") return "FBM";
  return canalVenta || "AMAZON";
}

export function computeGrossAmounts(row: {
  itemPrice: number;
  shippingPrice: number;
  giftWrapPrice: number;
  itemPromotionDiscount: number;
  shipPromotionDiscount: number;
}): number {
  return (
    row.itemPrice +
    row.shippingPrice +
    row.giftWrapPrice -
    row.itemPromotionDiscount -
    row.shipPromotionDiscount
  );
}

export function computeTaxAmounts(row: {
  itemTax: number;
  shippingTax: number;
  giftWrapTax: number;
}): number {
  return row.itemTax + row.shippingTax + row.giftWrapTax;
}

export function mapTipoCliente(isBusinessOrder: boolean): "B2B" | "B2C" {
  return isBusinessOrder ? "B2B" : "B2C";
}

export function buildOrderRowFingerprint(parts: {
  orderItemId: string;
  amazonOrderId: string;
  skuOriginal: string;
  asin: string;
  purchaseDateRaw: string;
  quantity: number;
  itemPrice: number;
}): string {
  const orderItemId = parts.orderItemId.trim();
  if (orderItemId) return orderItemId;

  const payload = [
    parts.amazonOrderId,
    parts.skuOriginal,
    parts.asin,
    parts.purchaseDateRaw,
    String(parts.quantity),
    String(parts.itemPrice),
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}

export function isCancelledStatus(status: string): boolean {
  const v = status.trim().toLowerCase();
  return v === "cancelled" || v === "canceled";
}

export function isStagingRowEligibleForVentas(params: {
  orderStatus: string;
  itemStatus: string;
  quantity: number;
}): boolean {
  if (params.quantity <= 0) return false;
  if (isCancelledStatus(params.orderStatus)) return false;
  if (isCancelledStatus(params.itemStatus)) return false;
  return true;
}
