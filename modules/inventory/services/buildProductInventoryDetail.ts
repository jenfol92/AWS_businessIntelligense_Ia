// modules/inventory/services/buildProductInventoryDetail.ts
//
// Detalle completo de inventario para un producto seleccionado.

import type { ProductForecastConfigUpsertBody } from "@/modules/planning/types";
import type { InventoryProductDetailResponse } from "../types/inventory.types";
import {
  buildCountryRowsForProduct,
  buildProductSummary,
} from "./buildInventoryProduct";
import { buildAnnualInventoryForecast } from "./buildAnnualInventoryForecast";
import { buildInventoryForecastPanel } from "./buildInventoryForecastPanel";
import { resolveCountryScope } from "./inventoryScope";
import {
  applyScopedProductMetrics,
  findProductInContext,
  loadInventoryContext,
} from "./loadInventoryContext";
import { buildOperationalStockSummary } from "./resolveOperationalStock";

export type ProductInventoryDetailParams = {
  canal?: string;
  pais?: string;
  windowDays?: number;
  forecastOverride?: ProductForecastConfigUpsertBody | null;
  debugStockout?: boolean;
};

export async function buildProductInventoryDetail(
  productId: string,
  params: ProductInventoryDetailParams = {},
): Promise<InventoryProductDetailResponse | null> {
  const windowDays = params.windowDays ?? 30;
  const ctx = await loadInventoryContext(params.canal, windowDays);
  const productRow = findProductInContext(ctx, productId);

  async function assembleDetail(
    targetId: string,
    product: ReturnType<typeof buildProductSummary>,
  ): Promise<InventoryProductDetailResponse> {
    const scopedProduct = applyScopedProductMetrics(
      product,
      ctx,
      params.pais,
      params.canal,
    );
    const countryScope = resolveCountryScope(params.pais);
    const countries = buildCountryRowsForProduct(targetId, ctx).filter((row) => {
      if (countryScope.countries == null) return true;
      return countryScope.countries.includes(row.pais);
    });
    const inbound = ctx.inbound.get(targetId) ?? [];
    const inboundUnitsConfirmedTotal = inbound
      .filter((row) => row.usableForPlanning !== false && row.planningKind !== "PURCHASE_ORDER_PROVISIONAL")
      .reduce((s, r) => s + r.cantidadPendiente, 0);
    const inboundUnitsProvisionalTotal = inbound
      .filter((row) => row.usableForPlanning === false || row.planningKind === "PURCHASE_ORDER_PROVISIONAL")
      .reduce((s, r) => s + r.cantidadPendiente, 0);
    const stockView = ctx.stockSuggestions.get(targetId);
    const stockSuggestion = stockView
      ? {
          diasCobertura: stockView.dias_cobertura,
          unidadesAPedir: stockView.unidades_a_pedir,
          riesgo: stockView.riesgo,
          leadTimeDays: stockView.lead_time_days,
        }
      : null;

    const baseProduct =
      productRow ?? ctx.products.find((p) => p.id === targetId);
    if (!baseProduct) {
      throw new Error("Producto no encontrado en contexto");
    }

    const stockoutRiskHint =
      scopedProduct.risk === "critico" ||
      scopedProduct.risk === "bajo" ||
      (stockSuggestion?.diasCobertura != null &&
        stockSuggestion.leadTimeDays != null &&
        stockSuggestion.diasCobertura < stockSuggestion.leadTimeDays);

    const productInvRows = ctx.inventoryRows.filter(
      (r) => r.producto_id === targetId,
    );
    const operationalStock = buildOperationalStockSummary(
      productInvRows,
      ctx.fbaLedgerLatest.get(targetId),
    );

    const annualForecast = await buildAnnualInventoryForecast(
      baseProduct,
      ctx.inventoryRows,
      inbound,
      ctx.products,
      {
        pais: params.pais,
        canal: params.canal,
        forecastOverride: params.forecastOverride,
        debugStockout: params.debugStockout,
        operationalStock,
      },
    );

    const forecast = await buildInventoryForecastPanel(
      scopedProduct,
      stockSuggestion,
      {
        pais: params.pais,
        canal: params.canal,
        windowDays,
        forecastOverride: params.forecastOverride,
        hasBenchmark: annualForecast.methodInfo?.dataAvailability.hasBenchmark,
        stockoutRiskHint,
        annualForecast,
      },
    );

    return {
      ok: true,
      product: scopedProduct,
      countries,
      inbound,
      inboundUnitsTotal: inboundUnitsConfirmedTotal + inboundUnitsProvisionalTotal,
      inboundUnitsConfirmedTotal,
      inboundUnitsProvisionalTotal,
      stockSuggestion,
      forecast,
      annualForecast,
      operationalStock,
      recentWindowDays: windowDays,
      simulationActive: params.forecastOverride != null,
      appliedForecastConfig: params.forecastOverride ?? undefined,
    };
  }

  if (!productRow) {
    const child = ctx.products.find((p) => p.id === productId);
    if (!child) return null;

    const product = buildProductSummary(child, ctx);
    return assembleDetail(productId, product);
  }

  const childRows = ctx.products.filter((p) => p.parent_id === productId);
  const variantes = childRows.map((c) => buildProductSummary(c, ctx));
  const product = buildProductSummary(productRow, ctx, variantes);

  return assembleDetail(productId, product);
}
