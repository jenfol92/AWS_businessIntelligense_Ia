// modules/inventory/services/buildProductInventoryForecast.ts
//
// Forecast completo para un producto de Inventario.
// Se carga por separado del detalle operativo para no bloquear
// stock, ventas, KPIs e inbound.

import type { ProductForecastConfigUpsertBody } from "@/modules/planning/types";

import type {
  InventoryProductForecastResponse,
} from "../types/inventory.types";

import { buildProductSummary } from "./buildInventoryProduct";
import { buildAnnualInventoryForecast } from "./buildAnnualInventoryForecast";
import { buildInventoryForecastPanel } from "./buildInventoryForecastPanel";
import { buildInventoryEtaRisk } from "./buildInventoryEtaRisk";

import {
  applyScopedProductMetrics,
  findProductInContext,
  loadInventoryContextForProduct,
} from "./loadInventoryContext";

import { buildOperationalStockSummary } from "./resolveOperationalStock";

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}

export type ProductInventoryForecastParams = {
  canal?: string;
  pais?: string;
  windowDays?: number;
  periodFrom?: string;
  periodTo?: string;
  forecastOverride?: ProductForecastConfigUpsertBody | null;
  debugStockout?: boolean;
  signal?: AbortSignal;
};

function logInventoryForecastTiming(
  productId: string,
  productIdsCount: number,
  label: string,
  start: number,
) {
  if (process.env.NODE_ENV !== "development") return;

  console.log(
    `[inventory-forecast timing] productId=${productId} productIds=${productIdsCount} ${label}: ${Date.now() - start}ms`,
  );
}



export async function buildProductInventoryForecast(
  productId: string,
  params: ProductInventoryForecastParams = {},
): Promise<InventoryProductForecastResponse | null> {
  const totalStart = Date.now();
  let productIdsCount = 0;

  try {
    throwIfAborted(params.signal);
    const windowDays = params.windowDays ?? 30;

    /*
     * El forecast vuelve a cargar su propio contexto.
     *
     * Esto duplica temporalmente algunas lecturas respecto al endpoint core,
     * pero es intencional en esta primera fase:
     * queremos sacar forecast del camino crítico sin cambiar su lógica.
     */
    const contextStart = Date.now();

    const ctx = await loadInventoryContextForProduct(
      productId,
      params.canal,
      windowDays,
      {
        fromDate: params.periodFrom,
        toDate: params.periodTo,
      },
      params.signal,
    );

    throwIfAborted(params.signal);

    productIdsCount = ctx.productIds.length;

    logInventoryForecastTiming(
      productId,
      productIdsCount,
      "loadInventoryContextForProduct",
      contextStart,
    );

    
    const productRow = findProductInContext(ctx, productId);

    let product: ReturnType<typeof buildProductSummary>;

    if (!productRow) {
      const child = ctx.products.find((p) => p.id === productId);

      if (!child) {
        return null;
      }

      product = buildProductSummary(child, ctx);
    } else {
      const childRows = ctx.products.filter(
        (p) => p.parent_id === productId,
      );

      const variantes = childRows.map((child) =>
        buildProductSummary(child, ctx),
      );

      product = buildProductSummary(
        productRow,
        ctx,
        variantes,
      );
    }

    throwIfAborted(params.signal);

   
    const scopedProduct = applyScopedProductMetrics(
      product,
      ctx,
      params.pais,
      params.canal,
    );

    const inbound = ctx.inbound.get(productId) ?? [];

    const stockView = ctx.stockSuggestions.get(productId);

    const stockSuggestion = stockView
      ? {
          diasCobertura: stockView.dias_cobertura,
          unidadesAPedir: stockView.unidades_a_pedir,
          riesgo: stockView.riesgo,
          leadTimeDays: stockView.lead_time_days,
        }
      : null;

    /*
     * buildAnnualInventoryForecast necesita el producto base,
     * no el summary scoped.
     *
     * Esta es la misma resolución que tenía antes
     * buildProductInventoryDetail.
     */
    const baseProduct =
      productRow ??
      ctx.products.find((p) => p.id === productId);

    if (!baseProduct) {
      return null;
    }

    /*
     * Conservamos exactamente el stock operativo que recibía
     * anteriormente buildAnnualInventoryForecast.
     */
    const productInvRows = ctx.inventoryRows.filter(
      (row) => row.producto_id === productId,
    );

    const operationalStockBase =
      buildOperationalStockSummary(
        productInvRows,
        ctx.fbaLedgerLatest.get(productId),
        ctx.fbaInventorySnapshotLatest.get(productId),
        {},
        ctx.fbmInventorySnapshotLatest.get(productId),
      );

    /*
     * Conservamos exactamente el cálculo anterior del hint.
     */
    const stockoutRiskHint =
      scopedProduct.risk === "critico" ||
      scopedProduct.risk === "bajo" ||
      (stockSuggestion?.diasCobertura != null &&
        stockSuggestion.leadTimeDays != null &&
        stockSuggestion.diasCobertura <
          stockSuggestion.leadTimeDays);

    /*
     * 1. Forecast anual
     *
     * Es exactamente la llamada que antes estaba dentro de
     * buildProductInventoryDetail.
     */
     // CORTE 2: no empezamos annual si ya está cancelado.
     throwIfAborted(params.signal);
    const annualForecastStart = Date.now();

    const annualForecast =
      await buildAnnualInventoryForecast(
        baseProduct,
        ctx.inventoryRows,
        inbound,
        ctx.products,
        {
          pais: params.pais,
          canal: params.canal,
          forecastOverride: params.forecastOverride,
          debugStockout: params.debugStockout,
          operationalStock: operationalStockBase,
        },
      );

    logInventoryForecastTiming(
      productId,
      productIdsCount,
      "buildAnnualInventoryForecast",
      annualForecastStart,
    );

    /*
     * 2. Panel forecast / planner
     *
     * Sigue esperando annualForecast igual que antes.
     * No estamos cambiando todavía la lógica del planner.
     */
     // CORTE 3: este es el más importante.
    // Si el usuario cambió de producto durante annual,
    // NO entramos en el planner.
    throwIfAborted(params.signal);

    const forecastPanelStart = Date.now();

    const forecast =
      await buildInventoryForecastPanel(
        scopedProduct,
        stockSuggestion,
        {
          pais: params.pais,
          canal: params.canal,
          windowDays,
          forecastOverride: params.forecastOverride,
          hasBenchmark:
            annualForecast.methodInfo?.dataAvailability
              .hasBenchmark,
          stockoutRiskHint,
          annualForecast,
        },
        params.signal,
      );

    logInventoryForecastTiming(
      productId,
      productIdsCount,
      "buildInventoryForecastPanel",
      forecastPanelStart,
    );

    /*
     * etaRisk también pertenecía al resultado forecast,
     * porque depende de estimatedStockoutDate.
     */
    // CORTE 4: si se abortó mientras trabajaba el planner,
    // no construimos ni devolvemos el resultado.
    throwIfAborted(params.signal);

    const etaRisk = buildInventoryEtaRisk(
      forecast.replenishment?.estimatedStockoutDate,
      inbound,
    );
     // CORTE 5: última comprobación antes del return.
     throwIfAborted(params.signal);

    return {
      ok: true,
      forecast,
      annualForecast,
      etaRisk,
    };
  } finally {
    logInventoryForecastTiming(
      productId,
      productIdsCount,
      "buildProductInventoryForecast total",
      totalStart,
    );
  }
}