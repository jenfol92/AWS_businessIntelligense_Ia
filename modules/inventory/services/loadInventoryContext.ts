// modules/inventory/services/loadInventoryContext.ts

//

// Carga paralela de datos base compartidos por dashboard y detalle de inventario.



import {

  fetchActiveProducts,

  fetchBenchmarkFlags,

  fetchInboundByProductIds,

  fetchInventoryRows,

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
import {
  buildOperationalStockSummary,
} from "./resolveOperationalStock";



export async function loadInventoryContext(

  canalRaw?: string,

  windowDays: number = 30,

) {

  const canal = normalizeCanal(canalRaw);

  const products = await fetchActiveProducts();

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

  ] = await Promise.all([

    fetchInventoryRows(productIds),

    fetchSalesAggregates(productIds, canal, windowDays),

    fetchProductDetailsMap(productIds),

    fetchSuppliersMap(

      products.map((p) => p.proveedor_id).filter(Boolean) as string[],

    ),

    fetchStockSuggestionsMap(productIds),

    fetchInboundByProductIds(productIds),

    fetchBenchmarkFlags(products),

    fetchLatestFbaLedgerStockByProductIds(productIds),

  ]);



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

  };

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
  const operational = buildOperationalStockSummary(
    invRows,
    ctx.fbaLedgerLatest.get(product.productoId),
  );

  const scopedInv =

    countryScope.countries == null

      ? invRows

      : invRows.filter((r) => countryScope.countries!.includes(r.pais));



  let stockFba = 0;
  let stockFbm = 0;
  let stockTotal = 0;

  if (
    countryScope.filter === "ALL" &&
    channelScope.filter === "ALL"
  ) {
    stockFba = operational.stockOperationalFba;
    stockFbm = operational.stockOperationalFbm;
    stockTotal = operational.stockOperationalTotal;
  } else if (
    countryScope.filter === "ALL" &&
    channelScope.filter === "AMAZON_FBA" &&
    operational.stockFbaLatestLedger != null
  ) {
    stockFba = operational.stockOperationalFba;
    stockFbm = 0;
    stockTotal = operational.stockOperationalFba;
  } else {
    for (const row of scopedInv) {
      stockFba += Number(row.stock_fba ?? 0);
      stockFbm += Number(row.stock_fbm ?? 0);
      stockTotal += stockForChannelRow(row, channelScope);
    }
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

