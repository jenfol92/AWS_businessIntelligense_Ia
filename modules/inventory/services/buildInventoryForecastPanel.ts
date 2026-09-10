// modules/inventory/services/buildInventoryForecastPanel.ts

//

// Panel de forecast corto para inventario (ventana reciente + filtros país/canal).



import { analyzeProducts } from "@/modules/planner/services/analyzeProducts";
import { findProductSupplyConfigByProductoId } from "@/modules/planning/repositories/productSupplyConfigRepository";
import {
  defaultProductSupplyConfig,
  mapRawToProductSupplyConfig,
} from "@/modules/planning/services/getProductSupplyConfig";
import type { ProductForecastConfigUpsertBody } from "@/modules/planning/types";
import type {
  AnnualInventoryForecast,
  InventoryForecastExplanation,
  InventoryForecastPanel,
  InventoryProductSummary,
} from "../types/inventory.types";
import { buildForecastMethodInfo } from "./buildForecastMethodInfo";
import {
  forecastMethodBusinessLabel,
  resolveDisplayForecastMethod,
} from "./forecastMethodUi";
import { resolveChannelScope, resolveCountryScope } from "./inventoryScope";



type StockSuggestion = {

  diasCobertura: number | null;

  unidadesAPedir: number;

  leadTimeDays: number | null;

} | null;



export type ForecastPanelParams = {

  pais?: string | null;

  canal?: string | null;

  windowDays?: number;

  forecastOverride?: ProductForecastConfigUpsertBody | null;

  hasBenchmark?: boolean;

  stockoutRiskHint?: boolean;

  /** Forecast anual ya calculado (prioridad para demanda de reposición). */
  annualForecast?: AnnualInventoryForecast;

};



function toPlannerChannel(

  canal?: string | null,

): "ALL" | "AMAZON_FBA" | "AMAZON_FBM" {

  return resolveChannelScope(canal).filter;

}



function toPlannerCountry(pais?: string | null): string {

  const scope = resolveCountryScope(pais);

  if (scope.filter === "ALL" || scope.filter === "EU") return "ALL";

  return scope.filter;

}



/**

 * Panel de reposición a corto plazo usando el planner con ventana reciente.

 * No sustituye al forecast anual (año natural anterior).

 */

export async function buildInventoryForecastPanel(

  product: InventoryProductSummary,

  stockSuggestion: StockSuggestion,

  scope: ForecastPanelParams = {},
  signal?: AbortSignal,

): Promise<InventoryForecastPanel> {

  const windowDays = scope.windowDays ?? 90;

  const country = toPlannerCountry(scope.pais);

  const channel = toPlannerChannel(scope.canal);



  const plannerResult = await analyzeProducts({

    windowDays,

    horizonMonths: 12,

    scenario: "base",

    country,

    channel,

    includeNewProducts: true,
    
    productIds: [product.productoId],

    forecastConfigOverrides: scope.forecastOverride

      ? { [product.productoId]: scope.forecastOverride }

      : undefined,

    replenishmentDemandOverrides: {
      [product.productoId]: {
        annualForecastMonthly: scope.annualForecast?.monthlyPlan.map(
          (line) => line.forecastSalesUnits,
        ),
        previousYearTotal: scope.annualForecast?.previousYearTotalUnits,
        recentSales30: product.salesUnits30,
        recentSales90: product.salesUnits90,
        useStockoutCorrectedForecast:
          scope.annualForecast?.stockoutCorrection?.applied === true,
      },
    },

  }, signal);


  const forecast =

    plannerResult.forecasts.find((f) => f.productId === product.productoId) ??

    null;

  const simulation =

    plannerResult.simulations.find((s) => s.productId === product.productoId) ??

    null;

  const planLine =

    plannerResult.annualPurchasePlan.lines.find(

      (l) => l.productId === product.productoId,

    ) ?? null;

  const replenishmentParams = plannerResult.replenishmentByProductId.get(
    product.productoId,
  );
  const replenishmentMeta = simulation?.replenishment;
  const annualTiming = scope.annualForecast?.simulationSummary?.timing;
  const timing = annualTiming ?? replenishmentMeta?.timing;
  const openingStock =
    scope.annualForecast?.currentOpeningStock ?? product.stockTotal;

  const calendarWarningsFromTiming =
    timing?.orderTodayCalendarEvents?.map(
      (e) =>
        e.type === "chinese_new_year"
          ? `Año Nuevo Chino: +${e.impactDays} días`
          : e.type === "golden_week"
            ? `Golden Week: +${e.impactDays} días`
            : `${e.name}: +${e.impactDays} días`,
    ) ?? [];

  const latestOrderDate =
    timing?.latestSafeOrderDate ??
    replenishmentMeta?.latestOrderDate ??
    null;

  const method = forecast?.method ?? product.forecastMethod ?? "NO_HISTORY";

  const explanations: InventoryForecastExplanation[] = [];

  if (
    replenishmentMeta?.replenishmentStatus === "URGENT" ||
    replenishmentMeta?.replenishmentStatus === "OVERDUE"
  ) {
    explanations.push({
      code: "LOW_COVERAGE",
      label:
        replenishmentMeta.replenishmentStatus === "URGENT"
          ? "Pedido urgente"
          : "Fecha límite vencida",
      detail:
        replenishmentMeta.replenishmentStatus === "URGENT"
          ? "Stock actual por debajo del punto de pedido."
          : "La fecha límite de pedido ya pasó; conviene pedir de inmediato.",
    });
  }



  if (product.stockTotal === 0 && product.hasHistory) {

    explanations.push({

      code: "STOCK_ZERO",

      label: "Stock 0",

      detail: "Pedir porque el stock actual es cero y hay demanda reciente.",

    });

  } else if (product.stockTotal === 0 && !product.hasHistory) {

    explanations.push({

      code: "STOCK_ZERO",

      label: "Stock 0",

      detail: "Stock agotado; sin histórico propio para estimar demanda.",

    });

  }



  if (

    stockSuggestion?.diasCobertura != null &&

    stockSuggestion.leadTimeDays != null &&

    stockSuggestion.diasCobertura < stockSuggestion.leadTimeDays

  ) {

    explanations.push({

      code: "LOW_COVERAGE",

      label: "Cobertura baja",

      detail: `Cobertura (~${Math.round(stockSuggestion.diasCobertura)} días) inferior al lead time (${Math.round(stockSuggestion.leadTimeDays)} días).`,

    });

  } else if (

    stockSuggestion?.diasCobertura != null &&

    stockSuggestion.diasCobertura < 30

  ) {

    explanations.push({

      code: "LOW_COVERAGE",

      label: "Cobertura baja",

      detail: `Cobertura estimada de ~${Math.round(stockSuggestion.diasCobertura)} días.`,

    });

  }



  if (method === "HISTORICAL_SIMPLE") {

    explanations.push({

      code: "HISTORICAL_FORECAST",

      label: "Forecast basado en histórico reciente",

      detail: `Previsión corto plazo con ventas de los últimos ${windowDays} días (filtros país/canal aplicados).`,

    });

  } else if (method === "NEW_PRODUCT_BENCHMARK") {

    explanations.push({

      code: "BENCHMARK_AVAILABLE",

      label: "Benchmark disponible",

      detail:

        "Producto sin histórico reciente; el planificador estima demanda con benchmark de competidores.",

    });

  } else if (
    (scope.annualForecast?.previousYearTotalUnits ?? 0) > 0 ||
    replenishmentParams?.demand.source === "ANNUAL_FORECAST_MONTH" ||
    replenishmentParams?.demand.source === "ANNUAL_AVERAGE"
  ) {

    explanations.push({

      code: "HISTORICAL_FORECAST",

      label: "Corto plazo reciente sin datos",

      detail: `No hay ventas en los últimos ${windowDays} días para este país/canal. La reposición usa el forecast anual (${replenishmentParams?.demand.basis ?? "histórico anual"}).`,

    });

  } else {

    explanations.push({

      code: "NO_HISTORY",

      label: "Sin histórico reciente",

      detail: `No hay ventas en los últimos ${windowDays} días para este país/canal.`,

    });

    explanations.push({

      code: "BENCHMARK_PENDING",

      label: "Benchmark pendiente",

      detail:

        "No hay snapshots de competidor con unidades estimadas para este producto y alcance.",

    });

  }



  const supplyRow = await findProductSupplyConfigByProductoId(product.productoId);
  const persisted = supplyRow
    ? mapRawToProductSupplyConfig(supplyRow)
    : defaultProductSupplyConfig(product.productoId);
  const supplyConfig = scope.forecastOverride
    ? {
        ...persisted,
        forecastMethod: scope.forecastOverride.forecastMethod,
        forecastMixOwnWeight: scope.forecastOverride.forecastMixOwnWeight,
        forecastMixCompetitorWeight:
          scope.forecastOverride.forecastMixCompetitorWeight,
        competitorCapturePct: scope.forecastOverride.competitorCapturePct,
        stockoutCorrectionEnabled:
          scope.forecastOverride.stockoutCorrectionEnabled,
      }
    : persisted;

  const hasRecentWindowSales = product.salesUnits30 > 0;
  const hasAnnualOwnSales =
    (scope.annualForecast?.previousYearTotalUnits ?? 0) > 0;
  const methodInfo = buildForecastMethodInfo({
    configuredMethod: supplyConfig.forecastMethod,
    hasOwnSales: hasRecentWindowSales,
    hasRecentWindowSales,
    hasAnnualOwnSales,
    hasBenchmark: scope.hasBenchmark === true,
    capturePct: supplyConfig.competitorCapturePct,
    mixOwnWeight: supplyConfig.forecastMixOwnWeight,
    mixCompetitorWeight: supplyConfig.forecastMixCompetitorWeight,
    stockoutCorrectionEnabled: supplyConfig.stockoutCorrectionEnabled,
    stockoutRiskHint: scope.stockoutRiskHint,
    stockoutCorrection: scope.annualForecast?.stockoutCorrection,
    horizonLabel: "corto plazo",
  });

  return {

    method,

    averageDailySales: forecast?.averageDailySales ?? 0,

    forecastUnitsMonth1: forecast?.monthly[0]?.forecastUnits ?? 0,

    recommendedOrderUnits:

      planLine?.recommendedOrderUnits ??

      (stockSuggestion?.unidadesAPedir ? stockSuggestion.unidadesAPedir : null),

    recommendedOrderDate: latestOrderDate ?? simulation?.recommendedOrderDate ?? null,

    needsReplenishment: simulation?.needsReplenishment ?? false,

    explanations,

    plannerForecast: forecast,

    methodInfo,

    replenishment:
      replenishmentMeta && replenishmentParams
        ? {
            leadTimeDays: replenishmentMeta.leadTimeDays,
            productionDays: replenishmentParams.productionDays,
            transitDays: replenishmentParams.transitDays,
            customsDays: replenishmentParams.customsDays,
            calendarDelayDays: replenishmentParams.calendarDelayDays,
            safetyBufferDays: replenishmentMeta.safetyBufferDays,
            leadTimeDemandUnits: replenishmentMeta.leadTimeDemandUnits,
            safetyStockUnits: replenishmentMeta.safetyStockUnits,
            reorderPointUnits: replenishmentMeta.reorderPointUnits,
            latestOrderDate,
            belowReorderPointDate:
              timing?.belowReorderPointDate ??
              replenishmentMeta.belowReorderPointDate,
            belowSafetyStockDate:
              timing?.belowSafetyStockDate ??
              replenishmentMeta.belowSafetyStockDate,
            estimatedStockoutDate:
              timing?.projectedStockoutDate ??
              simulation?.estimatedStockoutDate ??
              simulation?.dailySimulation?.estimatedStockoutDate ??
              null,
            stockoutDays:
              replenishmentMeta.stockoutDays ??
              simulation?.dailySimulation?.stockoutDays ??
              0,
            estimatedLostSalesUnits:
              timing?.orderTodayLostSalesBeforeArrival ??
              replenishmentMeta.estimatedLostSalesUnits ??
              simulation?.dailySimulation?.estimatedLostSalesUnits ??
              0,
            projectedStockAtArrival:
              replenishmentMeta.projectedStockAtArrival ??
              simulation?.dailySimulation?.projectedStockAtArrival,
            recommendedOrderUnits:
              (scope.annualForecast?.purchaseCyclePlan?.cycles.length ?? 0) > 0
                ? planLine?.recommendedOrderUnits ?? null
                : scope.annualForecast?.purchaseCyclePlan?.planningInbound.used
                      .length
                  ? 0
                  : planLine?.recommendedOrderUnits ?? null,
            additionalCapitalRequired:
              scope.annualForecast?.purchaseCyclePlan?.additionalCapitalRequired ??
              planLine?.purchaseCapitalRequired ??
              null,
            replenishmentStatus:
              (timing?.currentStockout ?? openingStock <= 0) &&
              (scope.annualForecast?.simulationSummary?.replenishmentStatus ===
                "OK" ||
                replenishmentMeta?.replenishmentStatus === "OK")
                ? "URGENT"
                : scope.annualForecast?.simulationSummary?.replenishmentStatus ??
                  replenishmentMeta?.replenishmentStatus ??
                  "OK",
            currentStock: openingStock,
            timing,
            orderTodayEta: timing?.orderTodayEta ?? null,
            orderTodayLostSalesBeforeArrival:
              timing?.lostSalesUntilNextInbound ??
              timing?.orderTodayLostSalesBeforeArrival ??
              0,
            orderTodayCalendarDelayDays:
              timing?.orderTodayCalendarDelayDays ??
              replenishmentParams.calendarDelayDays,
            requiredArrivalDate: timing?.requiredArrivalDate ?? null,
            latestSafeOrderDate: timing?.latestSafeOrderDate ?? null,
            isOrderAlreadyLate: timing?.isOrderAlreadyLate ?? false,
            currentStockout: timing?.currentStockout ?? openingStock <= 0,
            nextInboundDate: timing?.nextInboundDate ?? null,
            nextInboundUnits: timing?.nextInboundUnits ?? 0,
            lostSalesUntilNextInbound: timing?.lostSalesUntilNextInbound ?? 0,
            orderTodaySupersededByInbound:
              timing?.orderTodaySupersededByInbound ?? false,
            orderTodaySupersededMessage:
              timing?.orderTodaySupersededMessage ?? null,
            effectiveForecastMethod: scope.annualForecast?.methodInfo
              ? forecastMethodBusinessLabel(
                  resolveDisplayForecastMethod(
                    scope.annualForecast.methodInfo.configuredMethod,
                    scope.annualForecast.methodInfo.effectiveMethod,
                  ),
                )
              : undefined,
            dailyDemand: replenishmentParams.dailyDemand,
            demandSource: replenishmentParams.demand.source,
            calendarWarnings: Array.from(
              new Set([
                ...calendarWarningsFromTiming,
                ...(scope.annualForecast?.purchaseCycles ?? []).flatMap(
                  (c) => c.calendarWarnings ?? [],
                ),
                ...replenishmentMeta.warnings.filter((w) =>
                  w.includes("Año Nuevo Chino") || w.includes("Golden Week"),
                ),
              ]),
            ),
            purchaseCycles: scope.annualForecast?.purchaseCycles,
            warnings: replenishmentMeta.warnings.filter(
              (w) =>
                !w.includes("producto_supply_config.") &&
                !w.includes("default_") &&
                !w.includes("OWN_SALES_CORRECTED:"),
            ),
          }
        : undefined,
  };
}

