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
import {
  avgDaily,
  countryRisk,
  countryStockTotal,
  coverageDays,
  productRisk,
  salesKey,
  salesKeyGlobal,
} from "./inventoryMetrics";

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
  const countries: InventoryCountryStockRow[] = [];

  for (const inv of rows) {
    const stockFba = Number(inv.stock_fba ?? 0);
    const stockFbm = Number(inv.stock_fbm ?? 0);
    const stockTotal = countryStockTotal(
      stockFba,
      stockFbm,
      inv.stock_pais,
      ctx.canal,
    );
    const sales =
      ctx.sales.byProductCountry.get(salesKey(productId, inv.pais)) ??
      ({ units30: 0, units90: 0 } as SalesAgg);
    const avg30 = avgDaily(sales.units30, 30);
    const avg90 = avgDaily(sales.units90, 90);
    const avgUsed = Math.max(avg30, avg90);
    const cov = coverageDays(stockTotal, avgUsed);

    countries.push({
      pais: inv.pais,
      stockFba,
      stockFbm,
      stockTotal,
      salesUnits30: sales.units30,
      salesUnits90: sales.units90,
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

  let stockFba = 0;
  let stockFbm = 0;
  let stockTotal = 0;

  if (stockView) {
    stockFba = stockView.stock_fba;
    stockFbm = stockView.stock_fbm;
    stockTotal = stockView.stock_actual;
  } else {
    for (const c of countries) {
      stockFba += c.stockFba;
      stockFbm += c.stockFbm;
      stockTotal += c.stockTotal;
    }
  }

  const globalSales =
    ctx.sales.byProductGlobal.get(salesKeyGlobal(product.id)) ??
    ({ units30: 0, units90: 0 } as SalesAgg);

  const hasHistory = globalSales.units90 > 0;
  const hasBenchmark = ctx.benchmarkIds.has(product.id);
  const inboundRows = ctx.inbound.get(product.id) ?? [];
  const hasInbound = inboundRows.length > 0;

  const countryRisks = countries.map((c) => c.risk);
  const risk = productRisk(countryRisks, stockView?.riesgo);

  const coverage =
    stockView?.dias_cobertura ??
    coverageDays(
      stockTotal,
      Math.max(avgDaily(globalSales.units30, 30), avgDaily(globalSales.units90, 90)),
    );

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
    salesUnits30: globalSales.units30,
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
    default:
      return "OK";
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
