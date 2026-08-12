// modules/inventory/services/buildProductInventoryDetail.ts
//
// Detalle completo de inventario para un producto seleccionado.

import type { ProductForecastConfigUpsertBody } from "@/modules/planning/types";
import {
  fetchAmazonSyncJobStatus,
  fetchTopPriceByProductCountry,
} from "../repositories/inventoryRepository";
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
  loadInventoryContextForProduct,
} from "./loadInventoryContext";
import { buildOperationalStockSummary } from "./resolveOperationalStock";

function logInventoryDetailTiming(
  productId: string,
  productIdsCount: number,
  label: string,
  start: number,
) {
  if (process.env.NODE_ENV !== "development") return;
  console.log(
    `[inventory-detail timing] productId=${productId} productIds=${productIdsCount} ${label}: ${Date.now() - start}ms`,
  );
}

export type ProductInventoryDetailParams = {
  canal?: string;
  pais?: string;
  windowDays?: number;
  periodFrom?: string;
  periodTo?: string;
  forecastOverride?: ProductForecastConfigUpsertBody | null;
  debugStockout?: boolean;
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function buildProductInventoryDetail(
  productId: string,
  params: ProductInventoryDetailParams = {},
): Promise<InventoryProductDetailResponse | null> {
  const totalStart = Date.now();
  let productIdsCount = 0;

  try {
  const windowDays = params.windowDays ?? 30;
  const contextStart = Date.now();
  const ctx = await loadInventoryContextForProduct(
    productId,
    params.canal,
    windowDays,
    {
      fromDate: params.periodFrom,
      toDate: params.periodTo,
    },
  );
  productIdsCount = ctx.productIds.length;
  logInventoryDetailTiming(
    productId,
    productIdsCount,
    "loadInventoryContextForProduct",
    contextStart,
  );
  const fbaInventorySyncStatus = await fetchAmazonSyncJobStatus(
    "amazon_fba_inventory_snapshot",
  );
  const productRow = findProductInContext(ctx, productId);

  const assembleDetail = async (
    targetId: string,
    product: ReturnType<typeof buildProductSummary>,
  ): Promise<InventoryProductDetailResponse> => {
    const scopedStart = Date.now();
    const scopedProduct = applyScopedProductMetrics(
      product,
      ctx,
      params.pais,
      params.canal,
    );
    logInventoryDetailTiming(
      targetId,
      productIdsCount,
      "applyScopedProductMetrics",
      scopedStart,
    );
    const countryScope = resolveCountryScope(params.pais);
    const countryRowsStart = Date.now();
    const countries = buildCountryRowsForProduct(targetId, ctx).filter((row) => {
      if (countryScope.countries == null) return true;
      return countryScope.countries.includes(row.pais);
    });
    const countryCodes = countries.map((row) => row.pais);
    const today = todayIsoDate();
    const [topTodayByCountry, topPeriodByCountry] = await Promise.all([
      fetchTopPriceByProductCountry({
        productId: targetId,
        countries: countryCodes,
        channelScope: params.canal ?? ctx.canal,
        fromDate: today,
        toDate: today,
      }),
      fetchTopPriceByProductCountry({
        productId: targetId,
        countries: countryCodes,
        channelScope: params.canal ?? ctx.canal,
        fromDate: ctx.periodFrom,
        toDate: ctx.periodTo,
      }),
    ]);
    const countriesWithPriceTop = countries.map((row) => {
      const topToday = topTodayByCountry.get(row.pais) ?? null;
      const topPeriod = topPeriodByCountry.get(row.pais) ?? null;
      return {
        ...row,
        priceToday: topToday?.unitPrice ?? null,
        priceTodayUnits: topToday?.units ?? null,
        priceTopPeriod: topPeriod?.unitPrice ?? null,
        priceTopPeriodUnits: topPeriod?.units ?? null,
        priceTop30d: topPeriod?.unitPrice ?? null,
        priceTop30dUnits: topPeriod?.units ?? null,
        priceTop90d: null,
        priceTop90dUnits: null,
      };
    });
    logInventoryDetailTiming(
      targetId,
      productIdsCount,
      "buildCountryRowsForProduct",
      countryRowsStart,
    );
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
    const operationalStockStart = Date.now();
    const operationalStockBase = buildOperationalStockSummary(
      productInvRows,
      ctx.fbaLedgerLatest.get(targetId),
      ctx.fbaInventorySnapshotLatest.get(targetId),
      { preferLedgerSource: true },
    );

    const operationalStock = {
      ...operationalStockBase,
      fbaInventorySyncStatus,
    };
    logInventoryDetailTiming(
      targetId,
      productIdsCount,
      "buildOperationalStockSummary",
      operationalStockStart,
    );

    const annualForecastStart = Date.now();
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
        operationalStock: operationalStockBase,
      },
    );
    logInventoryDetailTiming(
      targetId,
      productIdsCount,
      "buildAnnualInventoryForecast",
      annualForecastStart,
    );

    const forecastPanelStart = Date.now();
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
    logInventoryDetailTiming(
      targetId,
      productIdsCount,
      "buildInventoryForecastPanel",
      forecastPanelStart,
    );

    return {
      ok: true,
      product: scopedProduct,
      countries: countriesWithPriceTop,
      inbound,
      inboundUnitsTotal: inboundUnitsConfirmedTotal + inboundUnitsProvisionalTotal,
      inboundUnitsConfirmedTotal,
      inboundUnitsProvisionalTotal,
      stockSuggestion,
      forecast,
      annualForecast,
      operationalStock,
      recentWindowDays: windowDays,
      periodLabel: ctx.periodLabel,
      periodDays: ctx.periodDays,
      periodFrom: ctx.periodFrom,
      periodTo: ctx.periodTo,
      simulationActive: params.forecastOverride != null,
      appliedForecastConfig: params.forecastOverride ?? undefined,
    };
  }

  if (!productRow) {
    const child = ctx.products.find((p) => p.id === productId);
    if (!child) return null;

    const summaryStart = Date.now();
    const product = buildProductSummary(child, ctx);
    logInventoryDetailTiming(
      productId,
      productIdsCount,
      "buildProductSummary",
      summaryStart,
    );
    return await assembleDetail(productId, product);
  };

  const summaryStart = Date.now();
  const childRows = ctx.products.filter((p) => p.parent_id === productId);
  const variantes = childRows.map((c) => buildProductSummary(c, ctx));
  const product = buildProductSummary(productRow, ctx, variantes);
  logInventoryDetailTiming(
    productId,
    productIdsCount,
    "buildProductSummary",
    summaryStart,
  );

  return await assembleDetail(productId, product);
  } finally {
    logInventoryDetailTiming(
      productId,
      productIdsCount,
      "buildProductInventoryDetail total",
      totalStart,
    );
  }
}
