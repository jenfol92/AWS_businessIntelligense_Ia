// modules/inventory/services/loadInventoryContext.ts

//

// Carga paralela de datos base compartidos por dashboard y detalle de inventario.



import {

  fetchActiveProducts,

  fetchBenchmarkFlags,

  fetchInventoryProductScope,

  fetchInboundByProductIds,

  fetchInventoryRows,

  fetchLatestFbaInventorySnapshotByProductIds,

  fetchLatestFbaInventoryByProductCountry,

  fetchLatestFbaLedgerStockByProductIds,

  fetchMarketplaceSalesAggregates,

  fetchProductDetailsMap,

  fetchSalesAggregates,

  fetchStockSuggestionsMap,

  fetchSuppliersMap,

} from "../repositories/inventoryRepository";

import type {

  InventoryProductSummary,

  ProductBaseRow,

} from "../types/inventory.types";

import {

  avgDaily,

  countryRisk,

  coverageDays,

  normalizeCanal,

  salesKey,

  salesKeyGlobal,

} from "./inventoryMetrics";

import { resolveCountryScope } from "./inventoryScope";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDaysInclusive(fromDate: string, toDate: string): number {
  const from = new Date(`${fromDate}T00:00:00.000Z`).getTime();
  const to = new Date(`${toDate}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 1;
  return Math.floor((to - from) / 86_400_000) + 1;
}

function formatPeriodLabel(params: {
  fromDate: string;
  toDate: string;
  windowDays: number;
  explicitRange: boolean;
}): string {
  const today = todayIsoDate();
  if (params.fromDate === today && params.toDate === today) return "Hoy";
  if (!params.explicitRange) return `${params.windowDays} dias`;

  const fmt = new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return `${fmt.format(new Date(`${params.fromDate}T00:00:00.000Z`))} - ${fmt.format(
    new Date(`${params.toDate}T00:00:00.000Z`),
  )}`;
}



async function timed<T>(

  productId: string | null,

  productIdsCount: number,

  label: string,

  fn: () => Promise<T>,

): Promise<T> {

  const start = Date.now();

  try {

    return await fn();

  } finally {

    if (process.env.NODE_ENV === "development") {
      console.log(

        `[inventory-detail timing] productId=${productId ?? "ALL"} productIds=${productIdsCount} ${label}: ${Date.now() - start}ms`,

      );
    }

  }

}


async function fetchLatestFbaLedgerStockWithTimeout(

  productIds: string[],

) {

  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const ledgerPromise = fetchLatestFbaLedgerStockByProductIds(productIds).catch(

    (error) => {

      console.error(

        "[inventory] latest FBA ledger failed",

        { productIdsCount: productIds.length, error },

      );

      return new Map();

    },

  );

  const timeoutPromise = new Promise<Awaited<typeof ledgerPromise>>((resolve) => {

    timeoutId = setTimeout(() => {

      console.warn("[inventory] latest FBA ledger skipped by timeout", {

        productIdsCount: productIds.length,

      });

      resolve(new Map());

    }, 700);

  });

  const result = await Promise.race([ledgerPromise, timeoutPromise]);

  if (timeoutId) clearTimeout(timeoutId);

  return result;

}


async function loadInventoryContextFromProducts(

  products: ProductBaseRow[],

  canalRaw?: string,

  windowDays: number = 30,

  periodRange?: { fromDate?: string | null; toDate?: string | null },

  productIdForLog?: string | null,

) {

  const totalStart = Date.now();

  const canal = normalizeCanal(canalRaw);

  const productIds = products.map((p) => p.id);
  const safeWindowDays = Math.max(1, Math.min(Math.round(windowDays), 365));
  const periodTo = normalizeIsoDate(periodRange?.toDate) ?? todayIsoDate();
  const periodFrom =
    normalizeIsoDate(periodRange?.fromDate) ?? addDaysIso(periodTo, -(safeWindowDays - 1));
  const periodDays = diffDaysInclusive(periodFrom, periodTo);
  const periodLabel = formatPeriodLabel({
    fromDate: periodFrom,
    toDate: periodTo,
    windowDays: periodDays,
    explicitRange: Boolean(periodRange?.fromDate || periodRange?.toDate),
  });



  const [

    inventoryRows,

    sales,

    marketplaceSales,

    details,

    suppliers,

    stockSuggestions,

    inbound,

    benchmarkIds,

    fbaLedgerLatest,

    fbaInventoryCountryLatest,

    fbaInventorySnapshotLatest,

  ] = await Promise.all([

    timed(productIdForLog ?? null, productIds.length, "fetchInventoryRows", () =>
      fetchInventoryRows(productIds),
    ),

    timed(productIdForLog ?? null, productIds.length, "fetchSalesAggregates", () =>
      fetchSalesAggregates(productIds, canal, safeWindowDays, {
        fromDate: periodFrom,
        toDate: periodTo,
      }),
    ),

    timed(productIdForLog ?? null, productIds.length, "fetchMarketplaceSalesAggregates", () =>
      fetchMarketplaceSalesAggregates(productIds, {
        window30Days: safeWindowDays,
        window90Days: 90,
      }),
    ),

    timed(productIdForLog ?? null, productIds.length, "fetchProductDetailsMap", () =>
      fetchProductDetailsMap(productIds),
    ),

    timed(productIdForLog ?? null, productIds.length, "fetchSuppliersMap", () =>
      fetchSuppliersMap(

        products.map((p) => p.proveedor_id).filter(Boolean) as string[],

      ),
    ),

    timed(productIdForLog ?? null, productIds.length, "fetchStockSuggestionsMap", () =>
      fetchStockSuggestionsMap(productIds),
    ),

    timed(productIdForLog ?? null, productIds.length, "fetchInboundByProductIds", () =>
      fetchInboundByProductIds(productIds),
    ),

    timed(productIdForLog ?? null, productIds.length, "fetchBenchmarkFlags", () =>
      fetchBenchmarkFlags(products),
    ),

    timed(productIdForLog ?? null, productIds.length, "fetchLatestFbaLedgerStockByProductIds", () =>
      fetchLatestFbaLedgerStockWithTimeout(productIds),
    ),

    timed(productIdForLog ?? null, productIds.length, "fetchLatestFbaInventoryByProductCountry", () =>
      productIdForLog
        ? fetchLatestFbaInventoryByProductCountry(productIds)
        : Promise.resolve(new Map()),
    ),

    timed(productIdForLog ?? null, productIds.length, "fetchLatestFbaInventorySnapshotByProductIds", () =>
      fetchLatestFbaInventorySnapshotByProductIds(productIds),
    ),

  ]);

  if (process.env.NODE_ENV === "development") {
    console.log(

      `[inventory-detail timing] productId=${productIdForLog ?? "ALL"} products=${products.length} productIds=${productIds.length} loadInventoryContextFromProducts total: ${Date.now() - totalStart}ms`,

    );
  }



  return {

    canal,

    windowDays: safeWindowDays,
    periodFrom,
    periodTo,
    periodDays,
    periodLabel,

    products,

    productIds,

    inventoryRows,

    sales,

    marketplaceSales,

    details,

    suppliers,

    stockSuggestions,

    inbound,

    benchmarkIds,

    fbaLedgerLatest,

    fbaInventoryCountryLatest,

    fbaInventorySnapshotLatest,

  };

}



export async function loadInventoryContext(

  canalRaw?: string,

  windowDays: number = 30,

  periodRange?: { fromDate?: string | null; toDate?: string | null },

) {

  const products = await fetchActiveProducts();

  return loadInventoryContextFromProducts(products, canalRaw, windowDays, periodRange);

}


export async function loadInventoryContextForProduct(

  productId: string,

  canalRaw?: string,

  windowDays: number = 30,

  periodRange?: { fromDate?: string | null; toDate?: string | null },

) {

  const products = await fetchInventoryProductScope(productId);

  return loadInventoryContextFromProducts(
    products,
    canalRaw,
    windowDays,
    periodRange,
    productId,
  );

}



export type InventoryContext = Awaited<ReturnType<typeof loadInventoryContext>>;



export function findProductInContext(

  ctx: InventoryContext,

  productId: string,

): ProductBaseRow | undefined {

  return ctx.products.find((p) => p.id === productId);

}



/** Ajusta stock y ventas recientes del resumen según filtros globales país/canal. */

export function applyScopedProductMetrics(

  product: InventoryProductSummary,

  ctx: InventoryContext,

  paisRaw?: string | null,

  canalRaw?: string | null,

): InventoryProductSummary {

  const countryScope = resolveCountryScope(paisRaw);

  const invRows = ctx.inventoryRows.filter((r) => r.producto_id === product.productoId);


  const scopedInv =

    countryScope.countries == null

      ? invRows

      : invRows.filter((r) => countryScope.countries!.includes(r.pais));



      let stockFba = 0;
      let stockFbm = 0;
      let stockTotal = 0;
      
      for (const row of scopedInv) {
        stockFba += Number(row.stock_fba ?? 0);
        stockFbm += Number(row.stock_fbm ?? 0);
      }
      stockTotal = stockFba + stockFbm;

      const snapshot = ctx.fbaInventorySnapshotLatest.get(product.productoId);
      const useGlobalSnapshot =
        countryScope.countries == null && snapshot?.fulfillableQuantity != null;
      if (useGlobalSnapshot) {
        stockFba = snapshot.fulfillableQuantity;
        stockTotal = stockFba + stockFbm;
      }


  let salesUnitsWindow = 0;

  let salesUnits90 = 0;

  if (countryScope.countries == null) {

    const globalSales = ctx.sales.byProductGlobal.get(

      salesKeyGlobal(product.productoId),

    );

    salesUnitsWindow = globalSales?.unitsPeriod ?? globalSales?.units30 ?? 0;

    salesUnits90 = globalSales?.units90 ?? 0;

  } else {

    for (const pais of countryScope.countries) {

      const agg = ctx.sales.byProductCountry.get(

        salesKey(product.productoId, pais),

      );

      salesUnitsWindow += agg?.unitsPeriod ?? agg?.units30 ?? 0;

      salesUnits90 += agg?.units90 ?? 0;

    }

  }



  const avgUsed = Math.max(

    avgDaily(salesUnitsWindow, ctx.periodDays),

  );



  const scopedCoverage = coverageDays(stockTotal, avgUsed);

  return {

    ...product,

    stockFba,

    stockFbm,

    stockTotal,

    salesUnitsPeriod: salesUnitsWindow,

    salesUnits30: salesUnitsWindow,

    salesUnits90,

    coverageDays: scopedCoverage,
    risk: countryRisk(stockTotal, scopedCoverage),

    stockFbaOperationalSource: useGlobalSnapshot
      ? "SP-API FBA Inventory"
      : product.stockFbaOperationalSource,

    stockFbaLatestSnapshot:
      snapshot?.fulfillableQuantity ?? product.stockFbaLatestSnapshot ?? null,

    stockFbaLatestSnapshotAt:
      snapshot?.snapshotAt ?? product.stockFbaLatestSnapshotAt ?? null,

    stockOperationalTotal: stockTotal,

    stockOperationalSource: useGlobalSnapshot
      ? "SP-API FBA Inventory"
      : product.stockOperationalSource,

    hasFbaSnapshot: Boolean(snapshot ?? product.hasFbaSnapshot),
  };

}
