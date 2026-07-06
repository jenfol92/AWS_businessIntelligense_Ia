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

  fetchLatestFbaLedgerStockByProductIds,

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

  coverageDays,

  normalizeCanal,

  salesKey,

  salesKeyGlobal,

} from "./inventoryMetrics";

import {

  resolveChannelScope,

  resolveCountryScope,

  stockForChannelRow,

} from "./inventoryScope";



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

  productIdForLog?: string | null,

) {

  const totalStart = Date.now();

  const canal = normalizeCanal(canalRaw);

  const productIds = products.map((p) => p.id);



  const [

    inventoryRows,

    sales,

    details,

    suppliers,

    stockSuggestions,

    inbound,

    benchmarkIds,

    fbaLedgerLatest,

    fbaInventorySnapshotLatest,

  ] = await Promise.all([

    timed(productIdForLog ?? null, productIds.length, "fetchInventoryRows", () =>
      fetchInventoryRows(productIds),
    ),

    timed(productIdForLog ?? null, productIds.length, "fetchSalesAggregates", () =>
      fetchSalesAggregates(productIds, canal, windowDays),
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

    windowDays,

    products,

    productIds,

    inventoryRows,

    sales,

    details,

    suppliers,

    stockSuggestions,

    inbound,

    benchmarkIds,

    fbaLedgerLatest,

    fbaInventorySnapshotLatest,

  };

}



export async function loadInventoryContext(

  canalRaw?: string,

  windowDays: number = 30,

) {

  const products = await fetchActiveProducts();

  return loadInventoryContextFromProducts(products, canalRaw, windowDays);

}


export async function loadInventoryContextForProduct(

  productId: string,

  canalRaw?: string,

  windowDays: number = 30,

) {

  const products = await fetchInventoryProductScope(productId);

  return loadInventoryContextFromProducts(
    products,
    canalRaw,
    windowDays,
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

  const channelScope = resolveChannelScope(canalRaw ?? ctx.canal);



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
        stockTotal += stockForChannelRow(row, channelScope);
      }


  let salesUnitsWindow = 0;

  let salesUnits90 = 0;

  if (countryScope.countries == null) {

    const globalSales = ctx.sales.byProductGlobal.get(

      salesKeyGlobal(product.productoId),

    );

    salesUnitsWindow = globalSales?.units30 ?? 0;

    salesUnits90 = globalSales?.units90 ?? 0;

  } else {

    for (const pais of countryScope.countries) {

      const agg = ctx.sales.byProductCountry.get(

        salesKey(product.productoId, pais),

      );

      salesUnitsWindow += agg?.units30 ?? 0;

      salesUnits90 += agg?.units90 ?? 0;

    }

  }



  const avgUsed = Math.max(

    avgDaily(salesUnitsWindow, ctx.windowDays),

    avgDaily(salesUnits90, 90),

  );



  return {

    ...product,

    stockFba,

    stockFbm,

    stockTotal,

    salesUnits30: salesUnitsWindow,

    salesUnits90,

    coverageDays: coverageDays(stockTotal, avgUsed),

  };

}
