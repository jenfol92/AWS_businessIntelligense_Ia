// modules/inventory/services/buildProductSalesByCountry.ts
//
// Ventas de un producto por país de marketplace en un periodo (modal tipo
// Shopkeeper) y detalle de un país: distribución de precios y líneas de venta.
//
// Fuente principal: pedidos Amazon por FECHA DE COMPRA, FBA + FBM, incluidos
// pendientes, agrupados por MARKETPLACE (amazon_order_items), igual que
// Shopkeeper y el informe de negocio de Amazon. Los cancelados no cuentan.
// Fallback (si la tabla de pedidos no existe): envíos FBA por fecha de envío.

import {
  fetchAmazonOrderItemsForProduct,
  fetchAmazonOrdersLastImportedAt,
  fetchFbaSalesLinesForProduct,
  type AmazonOrderItemReadRow,
} from "../repositories/inventoryRepository";
import type {
  InventoryCountryPriceChannel,
  InventorySalesOrdersSummary,
  InventorySalesSource,
  InventorySalesByCountryResponse,
  InventorySalesByCountryRow,
  InventorySalesCountryDetailResponse,
  InventorySalesLine,
  InventorySalesPriceRow,
} from "../types/inventory.types";
import { resolveCountryScope } from "./inventoryScope";

const MAX_RANGE_DAYS = 366;
const MAX_DETAIL_LINES = 500;

type SalesLine = InventorySalesLine & { country: string };

function isCancelled(row: AmazonOrderItemReadRow): boolean {
  return /cancel/i.test(String(row.order_status ?? "")) || /cancel/i.test(String(row.item_status ?? ""));
}

function orderRowToLine(row: AmazonOrderItemReadRow): SalesLine | null {
  const units = Number(row.quantity ?? 0);
  if (!Number.isFinite(units) || units <= 0 || isCancelled(row)) return null;
  const price = row.item_price == null ? null : Number(row.item_price);
  const grossAmount = price != null && Number.isFinite(price) && price > 0 ? price : null;
  const channel = String(row.fulfillment_channel ?? "").toUpperCase() === "FBM" ? "FBM" : "FBA";
  return {
    country: String(row.marketplace_country ?? "UNKNOWN").toUpperCase() || "UNKNOWN",
    saleDate: String(row.purchase_date).slice(0, 10),
    purchaseDate: String(row.purchase_date).slice(0, 10),
    amazonOrderId: row.amazon_order_id || null,
    units,
    unitPrice: grossAmount != null ? grossAmount / units : null,
    grossAmount,
    currency: String(row.currency ?? "EUR").toUpperCase() || "EUR",
    shipCountry: row.ship_country ? String(row.ship_country).toUpperCase() : null,
    fulfillmentCenter: null,
    salesChannel: row.sales_channel ?? null,
    fulfillmentChannel: channel,
    orderStatus: row.order_status ?? null,
    pending: /pending/i.test(String(row.order_status ?? "")),
  };
}

/**
 * Carga las líneas del producto en el periodo. Usa pedidos (fecha de compra) si la
 * tabla existe; si no, envíos FBA. Aplica filtros de canal y país (marketplace).
 */
async function loadSalesLines(
  productId: string,
  params: SalesPeriodParams,
  options: { applyScope: boolean } = { applyScope: true },
): Promise<{ source: InventorySalesSource; lines: SalesLine[] }> {
  const channel = normalizeChannel(params.canal);
  const scope = resolveCountryScope(params.pais);
  const inScope = (line: SalesLine) =>
    !options.applyScope || scope.countries == null || scope.countries.includes(line.country);

  const orderRows = await fetchAmazonOrderItemsForProduct({
    productId,
    fromDate: params.fromDate,
    toDate: params.toDate,
    signal: params.signal,
  });

  if (orderRows != null) {
    const lines = orderRows
      .map(orderRowToLine)
      .filter((l): l is SalesLine => l != null)
      .filter((l) => channel === "ALL" || l.fulfillmentChannel === channel)
      .filter(inScope);
    return { source: "amazon_orders", lines };
  }

  const fba =
    channel === "FBM"
      ? []
      : await fetchFbaSalesLinesForProduct({
          productId,
          fromDate: params.fromDate,
          toDate: params.toDate,
          signal: params.signal,
        });
  return {
    source: "fba_shipments",
    lines: fba.map((l) => ({ ...l, fulfillmentChannel: "FBA" as const })).filter(inScope),
  };
}

function channelBreakdown(lines: SalesLine[]) {
  let unitsFba = 0;
  let unitsFbm = 0;
  let unitsPending = 0;
  for (const l of lines) {
    if (l.fulfillmentChannel === "FBM") unitsFbm += l.units;
    else unitsFba += l.units;
    if (l.pending) unitsPending += l.units;
  }
  return { unitsFba, unitsFbm, unitsPending };
}

/** Resumen para la tarjeta de ventas del detalle (misma lógica que el modal). */
export async function summarizeProductSales(
  productId: string,
  params: SalesPeriodParams,
): Promise<InventorySalesOrdersSummary> {
  const [{ source, lines }, lastImportedAt] = await Promise.all([
    loadSalesLines(productId, params),
    fetchAmazonOrdersLastImportedAt(),
  ]);
  return {
    source,
    units: lines.reduce((s, l) => s + l.units, 0),
    ...channelBreakdown(lines),
    orders: new Set(lines.map((l, i) => l.amazonOrderId ?? `__line_${i}`)).size,
    lastImportedAt: source === "amazon_orders" ? lastImportedAt : null,
  };
}

export type SalesPeriodParams = {
  fromDate: string;
  toDate: string;
  canal?: string | null;
  pais?: string | null;
  signal?: AbortSignal;
};

export class SalesPeriodError extends Error {}

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000) + 1;
}

export function validateSalesPeriod(fromDate: unknown, toDate: unknown): {
  fromDate: string;
  toDate: string;
} {
  const from = typeof fromDate === "string" ? fromDate.slice(0, 10) : "";
  const to = typeof toDate === "string" ? toDate.slice(0, 10) : "";
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new SalesPeriodError("fromDate y toDate son obligatorios (YYYY-MM-DD).");
  }
  if (from > to) throw new SalesPeriodError("fromDate debe ser menor o igual que toDate.");
  if (daysBetweenInclusive(from, to) > MAX_RANGE_DAYS) {
    throw new SalesPeriodError(`El rango máximo es de ${MAX_RANGE_DAYS} días.`);
  }
  return { fromDate: from, toDate: to };
}

function normalizeChannel(raw: string | null | undefined): InventoryCountryPriceChannel {
  const value = String(raw ?? "ALL").trim().toUpperCase();
  if (value === "FBA" || value === "AMAZON_FBA") return "FBA";
  if (value === "FBM" || value === "AMAZON_FBM") return "FBM";
  return "ALL";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";
}

function summarizeCountry(country: string, lines: SalesLine[], totalUnits: number): InventorySalesByCountryRow {
  const units = lines.reduce((s, l) => s + l.units, 0);
  const priced = lines.filter((l) => l.unitPrice != null && l.grossAmount != null);
  const pricedUnits = priced.reduce((s, l) => s + l.units, 0);
  const grossAmount = priced.reduce((s, l) => s + (l.grossAmount ?? 0), 0);
  const prices = priced.map((l) => l.unitPrice as number);
  const orders = new Set(lines.map((l, i) => l.amazonOrderId ?? `__line_${i}`)).size;
  const channels = Array.from(new Set(lines.map((l) => l.salesChannel).filter(Boolean))) as string[];

  return {
    country,
    salesChannel: channels.sort().join(", ") || null,
    currency: mostCommon(lines.map((l) => l.currency)),
    units,
    orders,
    grossAmount: round2(grossAmount),
    avgUnitPrice: pricedUnits > 0 ? round2(grossAmount / pricedUnits) : null,
    minUnitPrice: prices.length ? round2(Math.min(...prices)) : null,
    maxUnitPrice: prices.length ? round2(Math.max(...prices)) : null,
    shareUnits: totalUnits > 0 ? round2((units / totalUnits) * 100) : 0,
    lastSaleDate: lines.reduce<string | null>(
      (max, l) => (max == null || l.saleDate > max ? l.saleDate : max),
      null,
    ),
    ...channelBreakdown(lines),
  };
}

export async function buildProductSalesByCountry(
  productId: string,
  params: SalesPeriodParams,
): Promise<InventorySalesByCountryResponse> {
  const channel = normalizeChannel(params.canal);
  const base = {
    ok: true as const,
    productId,
    periodFrom: params.fromDate,
    periodTo: params.toDate,
    channel,
  };

  const [{ source, lines }, lastImportedAt] = await Promise.all([
    loadSalesLines(productId, params),
    fetchAmazonOrdersLastImportedAt(),
  ]);

  if (source === "fba_shipments" && channel === "FBM") {
    return {
      ...base,
      countries: [],
      totals: { units: 0, orders: 0, amountByCurrency: [] },
      priceDetailUnavailable: true,
      source,
    };
  }
  const totalUnits = lines.reduce((s, l) => s + l.units, 0);

  const byCountry = new Map<string, SalesLine[]>();
  for (const line of lines) {
    const list = byCountry.get(line.country) ?? [];
    list.push(line);
    byCountry.set(line.country, list);
  }

  const countries = Array.from(byCountry.entries())
    .map(([country, rows]) => summarizeCountry(country, rows, totalUnits))
    .sort((a, b) => b.units - a.units || a.country.localeCompare(b.country));

  const amountByCurrency = new Map<string, number>();
  for (const c of countries) {
    amountByCurrency.set(c.currency, (amountByCurrency.get(c.currency) ?? 0) + c.grossAmount);
  }

  return {
    ...base,
    countries,
    totals: {
      units: totalUnits,
      orders: countries.reduce((s, c) => s + c.orders, 0),
      amountByCurrency: Array.from(amountByCurrency.entries())
        .map(([currency, amount]) => ({ currency, amount: round2(amount) }))
        .sort((a, b) => b.amount - a.amount),
    },
    priceDetailUnavailable: false,
    source,
    summary: {
      source,
      units: totalUnits,
      ...channelBreakdown(lines),
      orders: countries.reduce((s, c) => s + c.orders, 0),
      lastImportedAt: source === "amazon_orders" ? lastImportedAt : null,
    },
  };
}

export async function buildProductSalesCountryDetail(
  productId: string,
  country: string,
  params: SalesPeriodParams,
): Promise<InventorySalesCountryDetailResponse> {
  const code = country.trim().toUpperCase();
  const { source, lines: all } = await loadSalesLines(productId, params, { applyScope: false });
  const lines = all.filter((l) => l.country === code);
  const totalUnits = lines.reduce((s, l) => s + l.units, 0);

  const byPrice = new Map<string, { row: InventorySalesPriceRow; orders: Set<string> }>();
  lines.forEach((l, i) => {
    if (l.unitPrice == null || l.grossAmount == null) return;
    const unitPrice = round2(l.unitPrice);
    const key = `${l.currency}|${unitPrice.toFixed(2)}`;
    const entry =
      byPrice.get(key) ??
      {
        row: {
          unitPrice,
          currency: l.currency,
          units: 0,
          orders: 0,
          grossAmount: 0,
          shareUnits: 0,
          firstSaleDate: null,
          lastSaleDate: null,
        },
        orders: new Set<string>(),
      };
    entry.row.units += l.units;
    entry.row.grossAmount += l.grossAmount;
    entry.orders.add(l.amazonOrderId ?? `__line_${i}`);
    if (!entry.row.firstSaleDate || l.saleDate < entry.row.firstSaleDate) entry.row.firstSaleDate = l.saleDate;
    if (!entry.row.lastSaleDate || l.saleDate > entry.row.lastSaleDate) entry.row.lastSaleDate = l.saleDate;
    byPrice.set(key, entry);
  });

  const prices = Array.from(byPrice.values())
    .map(({ row, orders }) => ({
      ...row,
      orders: orders.size,
      grossAmount: round2(row.grossAmount),
      shareUnits: totalUnits > 0 ? round2((row.units / totalUnits) * 100) : 0,
    }))
    .sort((a, b) => b.units - a.units || b.unitPrice - a.unitPrice);

  const sortedLines = [...lines].sort(
    (a, b) => b.saleDate.localeCompare(a.saleDate) || (b.amazonOrderId ?? "").localeCompare(a.amazonOrderId ?? ""),
  );

  return {
    ok: true,
    productId,
    country: code,
    periodFrom: params.fromDate,
    periodTo: params.toDate,
    summary: lines.length ? summarizeCountry(code, lines, totalUnits) : null,
    prices,
    lines: sortedLines.slice(0, MAX_DETAIL_LINES).map(({ country: _c, ...line }) => line),
    linesTruncated: sortedLines.length > MAX_DETAIL_LINES,
    source,
  };
}
