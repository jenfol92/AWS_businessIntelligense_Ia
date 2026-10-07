// modules/inventory/services/buildInventoryProduct.ts
//
// Construye resúmenes de producto y filas por país a partir del contexto cargado.

import type {
  InventoryCountryStockRow,
  InventoryProductSummary,
  InventoryRiskLevel,
  InventoryRow,
  ProductBaseRow,
  SalesAgg,
} from "../types/inventory.types";
import type { InventoryContext } from "./loadInventoryContext";
import { buildOperationalStockSummary } from "./resolveOperationalStock";
import {
  avgDaily,
  countryRisk,
  coverageDays,
  productRisk,
  salesKey,
  salesKeyGlobal,
} from "./inventoryMetrics";

let snapshotAlignmentLogCount = 0;

/**
 * El stock FBM canónico (informe FBM de Amazon) es un único pool físico en el
 * almacén propio de España. Se asigna a esa fila de país en la tabla por país,
 * igual que lo usa el panel de stock operativo.
 */
const FBM_PHYSICAL_COUNTRY = "ES";

function stockTotalForCurrentChannel(params: {
  canal: string;
  stockFba: number | null;
  stockFbm: number | null;
}): number | null {
  if (params.stockFba == null) return null;
  return params.stockFba + (params.stockFbm ?? 0);
}

function inferForecastMethod(
  hasHistory: boolean,
  hasBenchmark: boolean,
): InventoryProductSummary["forecastMethod"] {
  if (hasHistory) return "HISTORICAL_SIMPLE";
  if (hasBenchmark) return "NEW_PRODUCT_BENCHMARK";
  return "NO_HISTORY";
}

export function buildCountryRowsForProduct(
  productId: string,
  ctx: InventoryContext,
): InventoryCountryStockRow[] {
  const rows = ctx.inventoryRows.filter((r) => r.producto_id === productId);
  const fbaRows = ctx.fbaInventoryCountryLatest.get(productId) ?? [];
  const canonicalFbm = ctx.fbmInventorySnapshotLatest.get(productId);
  const countries: InventoryCountryStockRow[] = [];
  const countryCodes = new Set<string>();

  for (const fba of fbaRows) countryCodes.add(fba.pais);
  if (canonicalFbm) {
    countryCodes.add(FBM_PHYSICAL_COUNTRY);
  }

  for (const pais of Array.from(countryCodes).sort((a, b) => a.localeCompare(b))) {
    const inv = rows.find((r) => r.pais === pais);
    const fba = fbaRows.find((r) => r.pais === pais);
    const stockFbaApp = Number(inv?.stock_fba ?? 0);
    const stockFba = fba?.stockSellable ?? null;
    const stockFbaUnsellable = fba?.stockUnsellable ?? null;
    const stockFbaPhysicalTotal = fba?.stockTotal ?? null;
    const stockFbm = canonicalFbm
      ? pais === FBM_PHYSICAL_COUNTRY
        ? canonicalFbm.availableQuantity
        : 0
      : null;
    const stockTotal = stockTotalForCurrentChannel({
      canal: ctx.canal,
      stockFba,
      stockFbm,
    });
    const sales =
      ctx.sales.byProductCountry.get(salesKey(productId, pais)) ??
      ({ unitsPeriod: 0, units30: 0, units60: 0, units90: 0 } as SalesAgg);
    const marketplaceSales = ctx.marketplaceSales.byProductMarketplace.get(
      salesKey(productId, pais),
    );
    const salesUnitsPeriod = sales.unitsPeriod ?? sales.units30;
    const avgPeriod = avgDaily(salesUnitsPeriod, ctx.periodDays);
    const avg30 = avgDaily(salesUnitsPeriod, ctx.periodDays);
    const avg90 = avgDaily(sales.units90, 90);
    const avgUsed = avgPeriod;
    const cov = stockTotal != null && fba?.coverageValid === true ? coverageDays(stockTotal, avgUsed) : null;

    countries.push({
      pais,
      stockFba,
      stockFbaUnsellable,
      stockFbaPhysicalTotal,
      stockFbaApp,
      stockFbaLedgerSnapshotDate: fba?.snapshotDate ?? null,
      stockFbaLastImportedAt: fba?.lastImportedAt ?? null,
      stockFbaLedgerStale: fba?.isStale ?? false,
      stockFbaLedgerStaleDays: fba?.staleDays ?? null,
      stockFbaResaleSellable: fba?.stockResaleSellable ?? 0,
      stockFbaUnknownConditionSellable: fba?.stockUnknownConditionSellable ?? 0,
      stockFbaLedgerCoverageValid: fba?.coverageValid ?? false,
      stockFbaInTransit: fba?.stockInTransit ?? 0,
      stockFbm,
      stockTotal,
      salesUnitsPeriod,
      salesUnits30: sales.units30,
      salesUnits60: sales.units60,
      salesUnits90: sales.units90,
      marketplaceSalesUnits30: marketplaceSales?.units30 ?? 0,
      marketplaceSalesUnits90: marketplaceSales?.units90 ?? 0,
      marketplaceSalesAmount30: marketplaceSales?.amount30 ?? 0,
      marketplaceSalesAmount90: marketplaceSales?.amount90 ?? 0,
      marketplaceSalesChannels: marketplaceSales?.salesChannels ?? [],
      marketplaceDeliveryBreakdown:
        marketplaceSales?.deliveryBreakdown ?? [],
      avgDailyPeriod: avgPeriod,
      avgDaily30: avg30,
      avgDaily90: avg90,
      coverageDays: cov,
      risk: countryRisk(stockTotal, cov),
    });
  }

  return countries.sort((a, b) => a.pais.localeCompare(b.pais));
}

export function buildProductSummary(
  product: ProductBaseRow,
  ctx: InventoryContext,
  variantes: InventoryProductSummary[] = [],
): InventoryProductSummary {
  const det = ctx.details.get(product.id);
  const sup = product.proveedor_id
    ? ctx.suppliers.get(product.proveedor_id)
    : undefined;
  const stockView = ctx.stockSuggestions.get(product.id);
  const countries = buildCountryRowsForProduct(product.id, ctx);
  const hasLedgerCountryRows = countries.some(
    (country) => country.stockFbaLedgerSnapshotDate != null,
  );

  const operational = buildOperationalStockSummary(
    ctx.inventoryRows.filter((row) => row.producto_id === product.id),
    ctx.fbaLedgerLatest.get(product.id),
    ctx.fbaInventorySnapshotLatest.get(product.id),
    {},
    ctx.fbmInventorySnapshotLatest.get(product.id),
  );
  let stockFba = operational.stockOperationalFba;
  let stockFbm = operational.stockOperationalFbm;
  let stockTotal = operational.stockOperationalTotal ?? stockFba;
  const legacyFba = stockView?.stock_fba ?? 0;

  const latestLedgerDate =
    countries
      .map((country) => country.stockFbaLedgerSnapshotDate)
      .filter(Boolean)
      .sort()
      .at(-1) ?? null;
  const canonicalFbaOperationalSource = operational.stockOperationalFbaSource;

  if (
    hasLedgerCountryRows &&
    process.env.NODE_ENV === "development" &&
    snapshotAlignmentLogCount < 10 &&
    legacyFba !== stockFba
  ) {
    snapshotAlignmentLogCount += 1;
    console.log("[inventory] stock summary aligned with FBA ledger", {
      productId: product.id,
      sku: product.sku,
      legacyFba,
      ledgerFba: stockFba,
      stockOperationalTotal: stockTotal,
      source: canonicalFbaOperationalSource,
    });
  }

  const globalSales =
    ctx.sales.byProductGlobal.get(salesKeyGlobal(product.id)) ??
    ({ unitsPeriod: 0, units30: 0, units60: 0, units90: 0 } as SalesAgg);

  const hasHistory = globalSales.units90 > 0;
  const hasBenchmark = ctx.benchmarkIds.has(product.id);
  const inboundRows = ctx.inbound.get(product.id) ?? [];
  const hasInbound = inboundRows.length > 0;
  const salesUnitsPeriod = globalSales.unitsPeriod ?? globalSales.units30;
  const avgDailyDemand = avgDaily(globalSales.units30, 30);

  const coverage = coverageDays(stockTotal, avgDailyDemand);
  const countryRisks = countries.map((c) => c.risk);
  const risk = productRisk(countryRisks, undefined);

  return {
    productoId: product.id,
    parentId: product.parent_id,
    sku: product.sku,
    nombre: product.nombre ?? product.sku,
    estado: product.estado,
    categoria: det?.categoria ?? null,
    imagenUrl: det?.imagen_url ?? null,
    proveedorId: product.proveedor_id,
    proveedorNombre: sup?.nombre ?? null,
    stockTotal,
    stockFba,
    stockFbm,
    stockFbaOperationalSource: canonicalFbaOperationalSource,
    stockFbaLatestSnapshot: operational.stockFbaLatestSnapshot,
    stockFbaLatestSnapshotAt: operational.stockFbaLatestSnapshotAt,
    stockOperationalTotal: stockTotal,
    stockOperationalSource: canonicalFbaOperationalSource,
    hasFbaSnapshot: operational.stockOperationalFbaSource === "fba_inventory_snapshot",
    salesUnitsPeriod,
    salesUnits30: globalSales.units30,
    salesUnits60: globalSales.units60,
    salesUnits90: globalSales.units90,
    coverageDays: coverage,
    risk,
    hasHistory,
    hasInbound,
    hasBenchmark,
    forecastMethod: inferForecastMethod(hasHistory, hasBenchmark),
    variantes,
  };
}

export function groupProductsWithVariants(
  products: ProductBaseRow[],
  ctx: InventoryContext,
): InventoryProductSummary[] {
  const summaries = new Map<string, InventoryProductSummary>();
  const childrenByParent = new Map<string, ProductBaseRow[]>();

  for (const p of products) {
    if (p.parent_id) {
      const list = childrenByParent.get(p.parent_id) ?? [];
      list.push(p);
      childrenByParent.set(p.parent_id, list);
    }
  }

  const roots: ProductBaseRow[] = [];
  const productById = new Map(products.map((p) => [p.id, p]));

  for (const p of products) {
    if (p.parent_id && productById.has(p.parent_id)) continue;
    roots.push(p);
  }

  for (const root of roots) {
    const childRows = childrenByParent.get(root.id) ?? [];
    const variantes = childRows.map((c) => buildProductSummary(c, ctx));
    summaries.set(root.id, buildProductSummary(root, ctx, variantes));
  }

  for (const p of products) {
    if (!summaries.has(p.id) && p.parent_id && !productById.has(p.parent_id)) {
      summaries.set(p.id, buildProductSummary(p, ctx));
    }
  }

  return Array.from(summaries.values()).sort((a, b) =>
    a.sku.localeCompare(b.sku),
  );
}

export function flattenForFilter(products: InventoryProductSummary[]): InventoryProductSummary[] {
  const out: InventoryProductSummary[] = [];
  for (const p of products) {
    out.push(p);
    for (const v of p.variantes) out.push(v);
  }
  return out;
}

export function matchesSearch(p: InventoryProductSummary, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return (
    p.sku.toLowerCase().includes(lower) ||
    p.nombre.toLowerCase().includes(lower) ||
    (p.proveedorNombre?.toLowerCase().includes(lower) ?? false)
  );
}

export function aggregateInventoryByProduct(
  inventoryRows: InventoryRow[],
): Map<string, InventoryRow[]> {
  const map = new Map<string, InventoryRow[]>();
  for (const row of inventoryRows) {
    const list = map.get(row.producto_id) ?? [];
    list.push(row);
    map.set(row.producto_id, list);
  }
  return map;
}

export function riskLabel(risk: InventoryRiskLevel): string {
  switch (risk) {
    case "critico":
      return "Crítico";
    case "bajo":
      return "Bajo";
    case "sin_ventas":
      return "Sin ventas";
      case "exceso":
        return "Exceso";
    case "saludable":
      return "Saludable";
    default:
      return "Saludable";
  }
}

export function forecastMethodLabel(
  method: InventoryProductSummary["forecastMethod"],
): string {
  switch (method) {
    case "HISTORICAL_SIMPLE":
      return "Histórico";
    case "NEW_PRODUCT_BENCHMARK":
      return "Benchmark";
    case "FAMILY_VARIANT_BENCHMARK":
      return "Familia";
    case "NO_HISTORY":
      return "Sin histórico";
    default:
      return "—";
  }
}
