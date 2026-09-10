// modules/inventory/services/buildAnnualInventoryForecast.ts
//
// Forecast anual por país/canal usando ventas del año natural anterior completo.

import {
  fetchBenchmarkSnapshotsForProduct,
  fetchPreviousYearMonthlySales,
  fetchPreviousYearMonthlySalesBatch,
} from "../repositories/inventoryRepository";
import { findProductSupplyConfigByProductoId } from "@/modules/planning/repositories/productSupplyConfigRepository";
import {
  defaultProductSupplyConfig,
  mapRawToProductSupplyConfig,
} from "@/modules/planning/services/getProductSupplyConfig";
import type { ProductForecastConfigUpsertBody } from "@/modules/planning/types";
import { buildForecastMethodInfo } from "./buildForecastMethodInfo";
import {
  normalizeForecastMixWeights,
  resolveForecastMethod,
} from "@/modules/planner/services/resolveForecastMethod";
import { fetchLastOrderLeadTimesByProductIds } from "@/modules/planner/repositories/replenishmentRepository";
import { resolveReplenishmentDemand } from "@/modules/planner/services/resolveReplenishmentDemand";
import { resolveReplenishmentParams } from "@/modules/planner/services/resolveReplenishmentParams";
import { correctOwnSalesForStockouts } from "@/modules/planner/services/correctOwnSalesForStockouts";
import { isStockoutDebugSku } from "@/modules/planner/services/stockoutCorrectionDebug";
import { loadLogisticsCalendarEventsForPlanning } from "@/modules/planner/services/loadLogisticsCalendarEvents";
import {
  aggregatePurchaseCyclesForMonth,
  buildPurchaseCycles,
} from "@/modules/planner/services/buildPurchaseCycles";
import { simulateDailyReplenishment, utcTodayIso, calendarDaysDifferenceUtc } from "@/modules/planner/services/simulateDailyReplenishment";
import { resolveReplenishmentTiming } from "@/modules/planner/services/resolveReplenishmentTiming";
import type { StockoutCorrectionResult } from "@/modules/planner/types/stockoutCorrection.types";
import {
  aggregateScheduleByEta,
  usableForPlanning as inboundUsableForPlanning,
} from "@/modules/planner/services/resolveInboundPlanningKind";
import type { ForecastInboundScheduleEntry } from "@/modules/planner/types/forecastInbound.types";
import type {
  AnnualForecastMonthlyLine,
  AnnualForecastReason,
  AnnualInventoryForecast,
  InventoryForecastMethod,
  InventoryInboundRow,
  InventoryRow,
  ProductBaseRow,
} from "../types/inventory.types";
import {
  benchmarkMarketplaceCountry,
  channelScopeLabel,
  countryScopeLabel,
  resolveCountryScope,
  resolveChannelScope,
  type ResolvedChannelScope,
  type ResolvedCountryScope,
} from "./inventoryScope";
import {
  resolveOpeningStockForScope,
  buildOperationalStockSummary,
  type OperationalStockSummary,
} from "./resolveOperationalStock";

export type AnnualForecastParams = {
  pais?: string | null;
  canal?: string | null;
  /** Override temporal; no persiste en BD. */
  forecastOverride?: ProductForecastConfigUpsertBody | null;
  /** Incluye payload debug de corrección por rotura en la respuesta. */
  debugStockout?: boolean;
  operationalStock?: OperationalStockSummary;
};

function sumArray(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

function medianPositive(values: number[]): number | null {
  const filtered = values.filter((v) => v > 0);
  if (filtered.length === 0) return null;
  const sorted = [...filtered].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function computeScopedStock(
  inventoryRows: InventoryRow[],
  countryScope: ResolvedCountryScope,
  channelScope: ResolvedChannelScope,
  operational?: OperationalStockSummary | null,
): number {
  return resolveOpeningStockForScope(
    inventoryRows,
    countryScope,
    channelScope,
    operational,
  );
}

function inboundUnitsByMonth(
  inbound: InventoryInboundRow[],
  forecastYear: number,
  confidence?: InventoryInboundRow["confidence"],
): number[] {
  const months = emptyMonthly();
  for (const row of inbound) {
    if (confidence && row.confidence !== confidence) continue;
    if (!row.eta) continue;
    const year = Number(row.eta.slice(0, 4));
    const month = Number(row.eta.slice(5, 7));
    if (year !== forecastYear || month < 1 || month > 12) continue;
    months[month - 1] += row.cantidadPendiente;
  }
  return months;
}

function emptyMonthly(): number[] {
  return Array.from({ length: 12 }, () => 0);
}

function averageSiblingMonthly(
  siblingMonthly: Map<string, number[]>,
): number[] | null {
  const averages = emptyMonthly();
  let usedMonths = 0;

  for (let m = 0; m < 12; m += 1) {
    const values: number[] = [];
    for (const monthly of Array.from(siblingMonthly.values())) {
      if (monthly[m] > 0) values.push(monthly[m]);
    }
    if (values.length > 0) {
      averages[m] = values.reduce((s, v) => s + v, 0) / values.length;
      usedMonths += 1;
    }
  }

  if (usedMonths === 0) return null;
  return averages.map((v) => Math.round(v));
}

function benchmarkMonthlyForecast(
  estimatedMonthlyUnits: number,
  quota = 0.07,
): number[] {
  const base = Math.ceil(estimatedMonthlyUnits * quota);
  return emptyMonthly().map((_, idx) => {
    if (idx === 0) return Math.ceil(base * 0.55);
    if (idx === 1) return Math.ceil(base * 0.75);
    if (idx === 2) return Math.ceil(base * 0.9);
    return base;
  });
}

function blendMonthlyForecasts(
  own: number[],
  competitor: number[],
  ownWeight: number,
  competitorWeight: number,
): number[] {
  return own.map((value, idx) =>
    Math.round(value * ownWeight + (competitor[idx] ?? 0) * competitorWeight),
  );
}

function resolveSiblingIds(
  product: ProductBaseRow,
  allProducts: ProductBaseRow[],
): string[] {
  if (product.parent_id) {
    return allProducts
      .filter((p) => p.parent_id === product.parent_id && p.id !== product.id)
      .map((p) => p.id);
  }
  return allProducts
    .filter((p) => p.parent_id === product.id)
    .map((p) => p.id);
}

function monthReason(
  method: InventoryForecastMethod,
  lostSalesUnits: number,
  closingPhysicalStock: number,
  forecastSalesUnits: number,
): AnnualForecastReason {
  if (method === "NO_HISTORY") return "NO_HISTORY";
  if (lostSalesUnits > 0) return "STOCKOUT_RISK";
  if (
    forecastSalesUnits > 0 &&
    closingPhysicalStock < forecastSalesUnits * 0.25
  ) {
    return "LOW_STOCK";
  }
  if (method === "FAMILY_VARIANT_BENCHMARK") return "FAMILY_VARIANT_BENCHMARK";
  if (method === "NEW_PRODUCT_BENCHMARK") return "NEW_PRODUCT_BENCHMARK";
  return "PREVIOUS_YEAR_SEASONAL";
}

function inboundRowsToSchedule(
  inbound: InventoryInboundRow[],
): ForecastInboundScheduleEntry[] {
  const entries = inbound
    .filter((row) => row.eta && row.cantidadPendiente > 0)
    .map((row) => ({
      eta: row.eta!,
      units: row.cantidadPendiente,
      confidence:
        row.confidence ??
        (row.contenedorId ? ("confirmed" as const) : ("provisional" as const)),
      planningKind: row.planningKind,
      usableForPlanning:
        row.planningKind != null
          ? inboundUsableForPlanning(row.planningKind) &&
            row.usableForPlanning !== false
          : row.confidence === "confirmed" &&
            row.usableForPlanning === true,
      ordenId: row.ordenId,
      numeroOrden: row.numeroOrden,
      forecastCountry: row.forecastCountry ?? null,
      forecastChannel: row.forecastChannel ?? "ALL",
    }));

  return aggregateScheduleByEta(entries);
}

function averageInboundUnitCost(inbound: InventoryInboundRow[]): number | null {
  const costs = inbound
    .map((row) => row.costeUnitarioEur)
    .filter((c): c is number => c != null && Number.isFinite(c) && c > 0);
  if (costs.length === 0) return null;
  return costs.reduce((s, c) => s + c, 0) / costs.length;
}

function daysUntilEndOfYear(fromIso: string, year: number): number {
  const end = `${year}-12-31`;
  return Math.max(1, calendarDaysDifferenceUtc(fromIso, end) + 1);
}

function committedCapitalFromInbound(
  inbound: InventoryInboundRow[],
): number | null {
  let total = 0;
  let hasCost = false;
  for (const row of inbound) {
    if (row.usableForPlanning === false) continue;
    if (
      row.usableForPlanning == null &&
      row.confidence === "provisional" &&
      row.planningKind !== "PURCHASE_ORDER_CONFIRMED"
    ) {
      continue;
    }
    const cost = row.costeUnitarioEur;
    const qty = row.cantidadPendiente;
    if (cost != null && Number.isFinite(cost) && cost > 0 && qty > 0) {
      total += cost * qty;
      hasCost = true;
    }
  }
  return hasCost ? total : null;
}

function buildAnnualMonthlyPlanFromDailySim(input: {
  countryLabel: string;
  channelLabel: ReturnType<typeof channelScopeLabel>;
  previousYearMonthly: number[];
  forecastMonthly: number[];
  forecastYear: number;
  openingStock: number;
  inbound: InventoryInboundRow[];
  method: InventoryForecastMethod;
  replenishment: ReturnType<typeof resolveReplenishmentParams>;
  stockoutCorrection?: StockoutCorrectionResult | null;
  calendarEvents: import("@/modules/planner/services/resolveLogisticsCalendarImpact").LogisticsCalendarEventInput[];
}): {
  monthlyPlan: AnnualForecastMonthlyLine[];
  simulationSummary: import("../types/inventory.types").AnnualInventorySimulationSummary;
  purchaseCycles: import("@/modules/planner/types/replenishment.types").PurchaseCycle[];
  purchaseCyclePlan: import("@/modules/planner/types/replenishment.types").PurchaseCyclePlan;
} {
  const schedule = inboundRowsToSchedule(input.inbound);
  const unitCostEur = averageInboundUnitCost(input.inbound);
  const today = utcTodayIso();
  const currentMonth = Number(today.slice(5, 7));

  const operationalSim = simulateDailyReplenishment({
    startDate: today,
    horizonDays: daysUntilEndOfYear(today, input.forecastYear),
    initialStock: input.openingStock,
    dailyDemand: {
      kind: "calendar_year",
      monthlyForecast: input.forecastMonthly,
      forecastYear: input.forecastYear,
    },
    previousYearMonthly: input.previousYearMonthly,
    inboundSchedule: schedule,
    reorderPointUnits: input.replenishment.reorderPointUnits,
    safetyStockUnits: input.replenishment.safetyStockUnits,
    leadTimeDays: input.replenishment.leadTimeDays,
    targetCoverageDays: input.replenishment.targetCoverageDays,
    replenishment: input.replenishment,
    unitCostEur,
    monthReason: (lostSales, closing, forecast) =>
      monthReason(input.method, lostSales, closing, forecast),
  });

  const operationalByMonth = new Map(
    operationalSim.monthlyPlan.map((line) => [Number(line.month), line]),
  );

  const purchaseCyclePlan = buildPurchaseCycles({
    initialStock: input.openingStock,
    dailyDemand: {
      kind: "calendar_year",
      monthlyForecast: input.forecastMonthly,
      forecastYear: input.forecastYear,
    },
    inboundSchedule: schedule,
    replenishment: input.replenishment,
    productionDays: input.replenishment.productionDays,
    transitDays: input.replenishment.transitDays,
    customsDays: input.replenishment.customsDays,
    calendarEvents: input.calendarEvents,
    unitCostEur,
    capitalAlreadyCommitted: committedCapitalFromInbound(input.inbound),
    horizonDays: 365,
    startDate: today,
  });
  const purchaseCycles = purchaseCyclePlan.cycles;

  const timingFromToday = resolveReplenishmentTiming({
    openingStock: input.openingStock,
    replenishment: input.replenishment,
    inboundSchedule: schedule,
    dailyDemandMode: {
      kind: "calendar_year",
      monthlyForecast: input.forecastMonthly,
      forecastYear: input.forecastYear,
    },
    calendarEvents: input.calendarEvents,
    horizonDays: daysUntilEndOfYear(today, input.forecastYear),
    orderDate: today,
  });

  const monthlyPlan: AnnualForecastMonthlyLine[] = Array.from(
    { length: 12 },
    (_, idx) => {
      const month = idx + 1;
      const correction = input.stockoutCorrection?.monthly.find(
        (m) => m.monthIndex === month,
      );
      const cycleAgg = aggregatePurchaseCyclesForMonth(
        purchaseCycles,
        month,
        input.forecastYear,
      );
      const forecastSalesUnits = Math.round(input.forecastMonthly[idx] ?? 0);
      const previousYearSalesUnits = Math.round(
        input.previousYearMonthly[idx] ?? 0,
      );

      if (month < currentMonth) {
        return {
          country: input.countryLabel,
          channel: input.channelLabel,
          month,
          previousYearSalesUnits,
          forecastSalesUnits,
          openingStock: 0,
          openingPhysicalStock: 0,
          inboundUnits: 0,
          inboundUnitsProvisional: 0,
          servedUnits: 0,
          lostSalesUnits: 0,
          projectedEndingStock: 0,
          closingPhysicalStock: 0,
          stockoutDays: 0,
          stockoutStartDate: null,
          stockoutEndDate: null,
          belowReorderPointDate: null,
          latestOrderDate: null,
          recommendedPurchaseUnits: 0,
          capitalRequired: null,
          reason: "PREVIOUS_YEAR_SEASONAL" as AnnualForecastReason,
          isPastMonth: true,
          isOperationalMonth: false,
          historicalDaysWithStock: correction?.daysWithStock,
          historicalStockoutDays: correction?.stockoutDays,
          correctedForecastUnits: correction?.correctedSalesUnits,
          historicalLostDemandUnits: correction?.estimatedLostDemandUnits,
          correctionConfidence: correction?.confidence,
          correctionWarning: correction?.warning,
        };
      }

      const line = operationalByMonth.get(month);
      const reason = (line?.reason ??
        monthReason(
          input.method,
          line?.lostSalesUnits ?? 0,
          line?.closingPhysicalStock ?? 0,
          forecastSalesUnits,
        )) as AnnualForecastReason;

      return {
        country: input.countryLabel,
        channel: input.channelLabel,
        month,
        previousYearSalesUnits,
        forecastSalesUnits: line?.forecastUnits ?? forecastSalesUnits,
        openingStock: line?.openingPhysicalStock ?? 0,
        openingPhysicalStock: line?.openingPhysicalStock ?? 0,
        inboundUnits: line?.inboundConfirmed ?? 0,
        inboundUnitsProvisional: line?.inboundProvisional ?? 0,
        servedUnits: line?.servedUnits ?? 0,
        lostSalesUnits: line?.lostSalesUnits ?? 0,
        projectedEndingStock: line?.closingPhysicalStock ?? 0,
        closingPhysicalStock: line?.closingPhysicalStock ?? 0,
        stockoutDays: line?.stockoutDays ?? 0,
        stockoutStartDate: line?.stockoutStartDate ?? null,
        stockoutEndDate: line?.stockoutEndDate ?? null,
        monthlyInboundFirstDate: line?.monthlyInboundFirstDate ?? null,
        lostSalesBeforeFirstInbound: line?.lostSalesBeforeFirstInbound ?? 0,
        servedAfterInbound: line?.servedAfterInbound ?? 0,
        stockAfterInbound: line?.stockAfterInbound ?? null,
        belowReorderPointDate: line?.belowReorderPointDate ?? null,
        latestOrderDate:
          cycleAgg.latestOrderDate ??
          (month === currentMonth
            ? timingFromToday.latestSafeOrderDate
            : null),
        recommendedPurchaseUnits: cycleAgg.recommendedPurchaseUnits,
        capitalRequired: cycleAgg.capitalRequired,
        reason,
        historicalDaysWithStock: correction?.daysWithStock,
        historicalStockoutDays: correction?.stockoutDays,
        correctedForecastUnits: correction?.correctedSalesUnits,
        historicalLostDemandUnits: correction?.estimatedLostDemandUnits,
        correctionConfidence: correction?.confidence,
        correctionWarning: correction?.warning,
        isPastMonth: false,
        isOperationalMonth: true,
      };
    },
  );

  const calendarWarnings = purchaseCycles.flatMap(
    (c) => c.calendarWarnings ?? [],
  );

  const timing = {
    projectedStockoutDate: timingFromToday.projectedStockoutDate,
    belowSafetyStockDate: timingFromToday.belowSafetyStockDate,
    belowReorderPointDate: timingFromToday.belowReorderPointDate,
    requiredArrivalDate: timingFromToday.requiredArrivalDate,
    latestSafeOrderDate: timingFromToday.latestSafeOrderDate,
    orderTodayEta: timingFromToday.orderTodayEta,
    orderTodayCalendarDelayDays: timingFromToday.orderTodayCalendarDelayDays,
    orderTodayLostSalesBeforeArrival:
      timingFromToday.orderTodayLostSalesBeforeArrival,
    orderTodayCalendarEvents: timingFromToday.orderTodayCalendarEvents,
    isOrderAlreadyLate: timingFromToday.isOrderAlreadyLate,
    currentStockout: timingFromToday.currentStockout,
    nextInboundDate: timingFromToday.nextInboundDate,
    nextInboundUnits: timingFromToday.nextInboundUnits,
    lostSalesUntilNextInbound: timingFromToday.lostSalesUntilNextInbound,
    orderTodaySupersededByInbound: timingFromToday.orderTodaySupersededByInbound,
    orderTodaySupersededMessage: timingFromToday.orderTodaySupersededMessage,
  };

  return {
    monthlyPlan,
    purchaseCycles,
    purchaseCyclePlan,
    simulationSummary: {
      estimatedStockoutDate: timingFromToday.projectedStockoutDate,
      stockoutDays: timingFromToday.dailySimulation.stockoutDays,
      estimatedLostSalesUnits:
        timingFromToday.lostSalesUntilNextInbound ??
        timingFromToday.dailySimulation.estimatedLostSalesUnits,
      belowReorderPointDate: timingFromToday.belowReorderPointDate,
      belowSafetyStockDate: timingFromToday.belowSafetyStockDate,
      latestOrderDate: timingFromToday.latestSafeOrderDate,
      projectedStockAtArrival:
        timingFromToday.dailySimulation.projectedStockAtArrival,
      replenishmentStatus: timingFromToday.replenishmentStatus,
      timing,
    },
  };
}

/**
 * Construye el plan anual mensual respetando país y canal.
 * El histórico base es siempre el año natural anterior completo (ignora windowDays).
 */
export async function buildAnnualInventoryForecast(
  product: ProductBaseRow,
  inventoryRows: InventoryRow[],
  inbound: InventoryInboundRow[],
  allProducts: ProductBaseRow[],
  params: AnnualForecastParams = {},
): Promise<AnnualInventoryForecast> {
  const now = new Date();
  const forecastYear = now.getFullYear();
  const baseYear = forecastYear - 1;

  const countryScope = resolveCountryScope(params.pais);
  const channelScope = resolveChannelScope(params.canal);
  const countryLabel = countryScopeLabel(countryScope);
  const channelLabel = channelScopeLabel(channelScope);

  const warnings: string[] = [];
  const productInvRows = inventoryRows.filter((r) => r.producto_id === product.id);
  const operationalStock =
    params.operationalStock ??
    buildOperationalStockSummary(productInvRows, null, null);
  const openingStock = computeScopedStock(
    productInvRows,
    countryScope,
    channelScope,
    operationalStock,
  );

  if (operationalStock.stockFbaDiscrepancy && operationalStock.discrepancyMessage) {
    warnings.push(operationalStock.discrepancyMessage);
  }

  const previousYearMonthly = await fetchPreviousYearMonthlySales(
    product.id,
    baseYear,
    countryScope.countries,
    channelScope.ventasCanal,
  );
  const previousYearTotal = sumArray(previousYearMonthly);

  const marketplaceCountry = benchmarkMarketplaceCountry(countryScope);
  const benchmark = await fetchBenchmarkSnapshotsForProduct(
    product.id,
    product.sku,
    marketplaceCountry,
  );

  if (countryScope.filter !== "ALL" && countryScope.filter !== "EU") {
    if (!benchmark.hasCountrySpecific && benchmark.hasAny) {
      warnings.push(
        "Benchmark disponible pero no específico para este país/canal.",
      );
    } else if (!benchmark.hasAny) {
      warnings.push("Benchmark no disponible para este país/canal.");
    }
  } else if (!benchmark.hasAny) {
    warnings.push("Benchmark no disponible para este país/canal.");
  }

  const competitorUnits = benchmark.rows
    .map((r) => Number(r.estimated_monthly_units ?? 0))
    .filter((u) => u > 0);
  const medianUnits = medianPositive(competitorUnits);
  const hasBenchmark = medianUnits != null;
  const hasOwnSales = previousYearTotal > 0;

  const supplyRow = await findProductSupplyConfigByProductoId(product.id);
  const persistedConfig = supplyRow
    ? mapRawToProductSupplyConfig(supplyRow)
    : defaultProductSupplyConfig(product.id);

  const supplyConfig = params.forecastOverride
    ? {
        ...persistedConfig,
        forecastMethod: params.forecastOverride.forecastMethod,
        forecastMixOwnWeight: params.forecastOverride.forecastMixOwnWeight,
        forecastMixCompetitorWeight:
          params.forecastOverride.forecastMixCompetitorWeight,
        competitorCapturePct: params.forecastOverride.competitorCapturePct,
        stockoutCorrectionEnabled:
          params.forecastOverride.stockoutCorrectionEnabled,
      }
    : persistedConfig;

  const captureQuota = supplyConfig.competitorCapturePct ?? 0.07;

  if (
    params.forecastOverride?.forecastMethod === "COMPETITOR_BENCHMARK" &&
    !hasBenchmark
  ) {
    warnings.push(
      "No hay benchmark disponible para este producto/país/canal. Se aplicará fallback a ventas propias o sin histórico.",
    );
  }

  const resolved = resolveForecastMethod({
    configuredMethod: supplyConfig.forecastMethod,
    hasOwnSales,
    hasBenchmark,
    stockoutCorrectionEnabled: supplyConfig.stockoutCorrectionEnabled,
  });

  let method: InventoryForecastMethod = "HISTORICAL_SIMPLE";
  let forecastMonthly = [...previousYearMonthly];
  let stockoutCorrection: StockoutCorrectionResult | null = null;

  type ForecastResolution = {
    method: InventoryForecastMethod;
    forecastMonthly: number[];
  };

  const applyNoOwnSalesFallback = async (): Promise<ForecastResolution> => {
    const siblingIds = resolveSiblingIds(product, allProducts);
    if (siblingIds.length > 0) {
      const siblingMonthly = await fetchPreviousYearMonthlySalesBatch(
        siblingIds,
        baseYear,
        countryScope.countries,
        channelScope.ventasCanal,
      );
      const familyPattern = averageSiblingMonthly(siblingMonthly);
      if (familyPattern && sumArray(familyPattern) > 0) {
        warnings.push(
          "Sin ventas propias en el año anterior; se usa el patrón de variantes hermanas en el mismo país/canal.",
        );
        return {
          method: "FAMILY_VARIANT_BENCHMARK",
          forecastMonthly: familyPattern,
        };
      }
    }
    warnings.push("Sin ventas del año anterior ni benchmark aplicable.");
    warnings.push("Forecast manual pendiente.");
    return { method: "NO_HISTORY", forecastMonthly: emptyMonthly() };
  };

  const applyCompetitorBenchmark = (): ForecastResolution => ({
    method: "NEW_PRODUCT_BENCHMARK",
    forecastMonthly: benchmarkMonthlyForecast(medianUnits!, captureQuota),
  });

  switch (resolved.method) {
    case "OWN_SALES":
      if (!hasOwnSales) {
        ({ method, forecastMonthly } = await applyNoOwnSalesFallback());
      }
      break;

    case "OWN_SALES_CORRECTED":
      if (!hasOwnSales) {
        ({ method, forecastMonthly } = await applyNoOwnSalesFallback());
      } else {
        stockoutCorrection = await correctOwnSalesForStockouts({
          productId: product.id,
          sku: product.sku,
          country: countryLabel,
          channel: channelScope.filter,
          baseYear,
          monthlyOwnSales: previousYearMonthly,
          benchmarkMonthlyUnits: hasBenchmark
            ? benchmarkMonthlyForecast(medianUnits!, captureQuota)
            : undefined,
          effectiveMethod: resolved.method,
          includeDebug:
            params.debugStockout === true || isStockoutDebugSku(product.sku),
        });
        forecastMonthly = stockoutCorrection.monthly.map(
          (m) => m.correctedSalesUnits,
        );
        for (const w of stockoutCorrection.warnings) {
          if (!warnings.includes(w)) warnings.push(w);
        }
        if (stockoutCorrection.applied) {
          warnings.push(
            `Demanda corregida por roturas: ${Math.round(stockoutCorrection.totalCorrectedSales)} uds/año (ventas reales ${Math.round(stockoutCorrection.totalActualSales)} uds).`,
          );
        }
      }
      break;

    case "COMPETITOR_BENCHMARK":
      if (hasBenchmark) {
        ({ method, forecastMonthly } = applyCompetitorBenchmark());
      } else if (hasOwnSales) {
        warnings.push(
          "COMPETITOR_BENCHMARK: sin benchmark disponible; fallback a ventas propias.",
        );
      } else {
        ({ method, forecastMonthly } = await applyNoOwnSalesFallback());
      }
      break;

    case "MIXED": {
      const { ownWeight, competitorWeight } = normalizeForecastMixWeights(
        supplyConfig.forecastMixOwnWeight,
        supplyConfig.forecastMixCompetitorWeight,
      );
      const ownPattern = hasOwnSales ? previousYearMonthly : emptyMonthly();
      const competitorPattern = hasBenchmark
        ? benchmarkMonthlyForecast(medianUnits!, captureQuota)
        : emptyMonthly();

      if (hasOwnSales && hasBenchmark) {
        method = "HISTORICAL_SIMPLE";
        forecastMonthly = blendMonthlyForecasts(
          ownPattern,
          competitorPattern,
          ownWeight,
          competitorWeight,
        );
        warnings.push(
          `Forecast MIXED (${Math.round(ownWeight * 100)}% propio / ${Math.round(competitorWeight * 100)}% competidor).`,
        );
      } else if (hasOwnSales) {
        warnings.push("MIXED: sin benchmark; fallback a ventas propias.");
      } else if (hasBenchmark) {
        warnings.push("MIXED: sin histórico propio; fallback a benchmark.");
        ({ method, forecastMonthly } = applyCompetitorBenchmark());
      } else {
        ({ method, forecastMonthly } = await applyNoOwnSalesFallback());
      }
      break;
    }

    default:
      if (hasOwnSales) {
        break;
      }
      if (hasBenchmark) {
        ({ method, forecastMonthly } = applyCompetitorBenchmark());
      } else {
        ({ method, forecastMonthly } = await applyNoOwnSalesFallback());
      }
  }

  const lastOrderLeadMap = await fetchLastOrderLeadTimesByProductIds([product.id]);
  const lastOrder = lastOrderLeadMap.get(product.id);

  const calendarEvents = await loadLogisticsCalendarEventsForPlanning(utcTodayIso());

  const demand = resolveReplenishmentDemand({
    annualForecastMonthly: forecastMonthly,
    previousYearTotal: previousYearTotal,
    benchmarkMonthlyUnits: hasBenchmark
      ? benchmarkMonthlyForecast(medianUnits!, captureQuota)[0]
      : undefined,
    useStockoutCorrectedForecast: stockoutCorrection?.applied === true,
  });
  const replenishment = resolveReplenishmentParams({
    productId: product.id,
    demand,
    supplyConfig,
    hasSupplyConfigRow: supplyRow != null,
    lastOrderProductionDays: lastOrder?.leadTimeProduccion ?? null,
    lastOrderTransitDays: lastOrder?.leadTimeTransito ?? null,
    calendarEvents,
  });

  const { monthlyPlan, simulationSummary, purchaseCycles, purchaseCyclePlan } =
    buildAnnualMonthlyPlanFromDailySim({
    countryLabel,
    channelLabel,
    previousYearMonthly,
    forecastMonthly,
    forecastYear,
    openingStock,
    inbound,
    method,
    replenishment,
    stockoutCorrection,
    calendarEvents,
  });

  if (method === "NO_HISTORY") {
    for (const line of monthlyPlan) {
      if (line.reason !== "NO_HISTORY") continue;
      line.reason = "MANUAL_FORECAST_PENDING";
    }
  }

  const stockoutRiskHint = monthlyPlan.some(
    (line) =>
      line.reason === "STOCKOUT_RISK" || line.reason === "LOW_STOCK",
  );

  const methodInfo = buildForecastMethodInfo({
    configuredMethod: supplyConfig.forecastMethod,
    hasOwnSales,
    hasBenchmark,
    capturePct: captureQuota,
    mixOwnWeight: supplyConfig.forecastMixOwnWeight,
    mixCompetitorWeight: supplyConfig.forecastMixCompetitorWeight,
    stockoutCorrectionEnabled: supplyConfig.stockoutCorrectionEnabled,
    stockoutRiskHint,
    stockoutCorrection: stockoutCorrection ?? undefined,
    horizonLabel: "anual",
  });

  for (const w of methodInfo.warnings) {
    if (!warnings.includes(w)) warnings.push(w);
  }

  for (const w of purchaseCyclePlan.warnings) {
    if (!warnings.includes(w)) warnings.push(w);
  }

  return {
    method,
    country: countryLabel,
    channel: channelLabel,
    baseYear,
    forecastYear,
    previousYearTotalUnits: previousYearTotal,
    currentOpeningStock: openingStock,
    monthlyPlan,
    simulationSummary,
    purchaseCycles,
    purchaseCyclePlan,
    stockoutCorrection: stockoutCorrection ?? undefined,
    stockoutCorrectionDebug: stockoutCorrection?.debug,
    warnings,
    methodInfo,
  };
}

export type { ResolvedCountryScope, ResolvedChannelScope };
