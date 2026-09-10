import type { ProductSupplyConfig } from "@/modules/planning/types";
import type {
  ReplenishmentDemand,
  ReplenishmentParams,
  ReplenishmentRecommendationBreakdown,
} from "../types/replenishment.types";
import type { ForecastInboundScheduleEntry } from "../types/forecastInbound.types";
import {
  simulateDailyReplenishment,
  utcTodayIso,
} from "./simulateDailyReplenishment";
import { scheduleEntryUsableForPlanning } from "./resolveInboundPlanningKind";
import {
  type LogisticsCalendarEventInput,
  resolveLogisticsCalendarImpact,
} from "./resolveLogisticsCalendarImpact";

export const DEFAULT_REPLENISHMENT_PRODUCTION_DAYS = 30;
export const DEFAULT_REPLENISHMENT_TRANSIT_DAYS = 45;
export const DEFAULT_REPLENISHMENT_CUSTOMS_DAYS = 7;
export const DEFAULT_SAFETY_BUFFER_DAYS = 15;
export const DEFAULT_TARGET_COVERAGE_DAYS = 90;
/** Valor insertado por defecto al crear fila supply; no se trata como config manual. */
export const SUPPLY_CONFIG_DEFAULT_STOCK_SEGURIDAD_DIAS = 45;

export type ResolveReplenishmentParamsInput = {
  productId: string;
  demand: ReplenishmentDemand;
  targetCoverageDays?: number;
  supplyConfig?: ProductSupplyConfig | null;
  hasSupplyConfigRow?: boolean;
  supplierProductionDays?: number | null;
  supplierTransitDays?: number | null;
  lastOrderProductionDays?: number | null;
  lastOrderTransitDays?: number | null;
  moq?: number | null;
  unitsPerCarton?: number | null;
  calendarEvents?: LogisticsCalendarEventInput[];
  orderDateForCalendar?: string;
};

function positiveInt(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  return n > 0 ? n : null;
}

function resolveDayComponent(params: {
  supplyValue: number | null;
  supplierValue: number | null;
  lastOrderValue: number | null;
  defaultValue: number;
  supplyLabel: string;
  supplierLabel: string;
  lastOrderLabel: string;
  defaultLabel: string;
  defaultWarning: string;
  warnings: string[];
}): { days: number; source: string } {
  const supply = positiveInt(params.supplyValue);
  if (supply != null) {
    return { days: supply, source: params.supplyLabel };
  }

  const supplier = positiveInt(params.supplierValue);
  if (supplier != null) {
    return { days: supplier, source: params.supplierLabel };
  }

  const lastOrder = positiveInt(params.lastOrderValue);
  if (lastOrder != null) {
    return { days: lastOrder, source: params.lastOrderLabel };
  }

  params.warnings.push(params.defaultWarning);
  return { days: params.defaultValue, source: params.defaultLabel };
}

function resolveSafetyBufferDays(
  supplyConfig: ProductSupplyConfig | null | undefined,
  hasSupplyConfigRow: boolean,
  warnings: string[],
): { days: number; source: string } {
  const configured = positiveInt(supplyConfig?.stockSeguridadDias);
  const isExplicitConfig =
    hasSupplyConfigRow &&
    configured != null &&
    configured !== SUPPLY_CONFIG_DEFAULT_STOCK_SEGURIDAD_DIAS;

  if (isExplicitConfig && configured != null) {
    warnings.push(`Buffer de seguridad configurado: ${configured} días.`);
    return {
      days: configured,
      source: "producto_supply_config.stock_seguridad_dias",
    };
  }

  warnings.push(`Buffer de seguridad usado: ${DEFAULT_SAFETY_BUFFER_DAYS} días.`);
  return {
    days: DEFAULT_SAFETY_BUFFER_DAYS,
    source: "default_global_15",
  };
}

function resolveMoqSource(
  productMoq: number | null | undefined,
  supplyMoq: number | null | undefined,
): { moq: number | null; source: string } {
  const fromProduct = positiveInt(productMoq);
  if (fromProduct != null) {
    return { moq: fromProduct, source: "producto_logistica.pedido_minimo_unidades" };
  }
  const fromSupply = positiveInt(supplyMoq);
  if (fromSupply != null) {
    return { moq: fromSupply, source: "producto_supply_config.moq" };
  }
  return { moq: DEFAULT_GLOBAL_FACTORY_MOQ, source: "business_rule.global_factory_moq_100" };
}

function resolveUnitsPerCartonSource(
  productUnits: number | null | undefined,
  supplyUnits: number | null | undefined,
): { units: number | null; source: string } {
  const fromProduct = positiveInt(productUnits);
  if (fromProduct != null) {
    return { units: fromProduct, source: "producto_logistica.unidades_por_caja" };
  }
  const fromSupply = positiveInt(supplyUnits);
  if (fromSupply != null) {
    return {
      units: fromSupply,
      source: "producto_supply_config.master_carton_qty",
    };
  }
  return { units: null, source: "none" };
}

export function resolveReplenishmentParams(
  input: ResolveReplenishmentParamsInput,
): ReplenishmentParams {
  const warnings: string[] = [...input.demand.warnings];
  const dailyDemand = Math.max(0, input.demand.dailyDemand);
  const targetCoverageDays =
    positiveInt(input.targetCoverageDays) ?? DEFAULT_TARGET_COVERAGE_DAYS;

  if (dailyDemand <= 0) {
    if (!warnings.some((w) => w.includes("Sin demanda diaria"))) {
      warnings.push(
        "Sin demanda diaria estimada; no se calcula punto de pedido ni unidades recomendadas.",
      );
    }
  }

  const production = resolveDayComponent({
    supplyValue: input.supplyConfig?.leadTimeProduccionDias ?? null,
    supplierValue: input.supplierProductionDays ?? null,
    lastOrderValue: input.lastOrderProductionDays ?? null,
    defaultValue: DEFAULT_REPLENISHMENT_PRODUCTION_DAYS,
    supplyLabel: "producto_supply_config.lead_time_produccion_dias",
    supplierLabel: "proveedores.dias_produccion_estandar",
    lastOrderLabel: "ordenes_compra.lead_time_produccion",
    defaultLabel: "default_30",
    defaultWarning: `Producción no configurada; se usa default ${DEFAULT_REPLENISHMENT_PRODUCTION_DAYS} días.`,
    warnings,
  });

  const transit = resolveDayComponent({
    supplyValue: input.supplyConfig?.leadTimeTransporteDias ?? null,
    supplierValue: input.supplierTransitDays ?? null,
    lastOrderValue: input.lastOrderTransitDays ?? null,
    defaultValue: DEFAULT_REPLENISHMENT_TRANSIT_DAYS,
    supplyLabel: "producto_supply_config.lead_time_transporte_dias",
    supplierLabel: "proveedores.dias_transito_estandar",
    lastOrderLabel: "ordenes_compra.lead_time_transito",
    defaultLabel: "default_45",
    defaultWarning: `Tránsito no configurado; se usa default ${DEFAULT_REPLENISHMENT_TRANSIT_DAYS} días.`,
    warnings,
  });

  const customsSupply = positiveInt(input.supplyConfig?.leadTimeAduanaDias);
  let customsDays: number;
  let customsSource: string;
  if (customsSupply != null) {
    customsDays = customsSupply;
    customsSource = "producto_supply_config.lead_time_aduana_dias";
  } else {
    customsDays = DEFAULT_REPLENISHMENT_CUSTOMS_DAYS;
    customsSource = "default_7";
    warnings.push(
      `Aduana no configurada; se usa default ${DEFAULT_REPLENISHMENT_CUSTOMS_DAYS} días.`,
    );
  }

  const domesticDays = 0;
  warnings.push(
    "No hay campo de tránsito terrestre/domestic configurado; se usa 0.",
  );

  const calendarDelayDays =
    input.calendarEvents && input.calendarEvents.length > 0
      ? resolveLogisticsCalendarImpact({
          orderDate: input.orderDateForCalendar ?? utcTodayIso(),
          productionDays: production.days,
          transitDays: transit.days,
          customsDays,
          events: input.calendarEvents,
        }).delayDays
      : 0;

  if (calendarDelayDays > 0) {
    warnings.push(
      `Calendario logístico añade ${calendarDelayDays} días al lead time.`,
    );
  }

  const safety = resolveSafetyBufferDays(
    input.supplyConfig,
    input.hasSupplyConfigRow === true,
    warnings,
  );

  const moqResolved = resolveMoqSource(
    input.moq,
    input.supplyConfig?.moq ?? null,
  );
  const cartonResolved = resolveUnitsPerCartonSource(
    input.unitsPerCarton,
    input.supplyConfig?.masterCartonQty ?? null,
  );

  const leadTimeDays =
    production.days +
    transit.days +
    customsDays +
    domesticDays +
    calendarDelayDays;

  const leadTimeDemandUnits =
    dailyDemand > 0 ? Math.ceil(dailyDemand * leadTimeDays) : 0;
  const safetyStockUnits =
    dailyDemand > 0 ? Math.ceil(dailyDemand * safety.days) : 0;
  const reorderPointUnits =
    dailyDemand > 0
      ? Math.ceil(dailyDemand * (leadTimeDays + safety.days))
      : 0;

  return {
    productId: input.productId,
    demand: input.demand,
    dailyDemand,
    productionDays: production.days,
    transitDays: transit.days,
    customsDays,
    domesticDays,
    calendarDelayDays,
    leadTimeDays,
    safetyBufferDays: safety.days,
    leadTimeDemandUnits,
    safetyStockUnits,
    reorderPointUnits,
    targetCoverageDays,
    moq: moqResolved.moq,
    unitsPerCarton: cartonResolved.units,
    source: {
      productionDays: production.source,
      transitDays: transit.source,
      customsDays: customsSource,
      safetyBufferDays: safety.source,
      moq: moqResolved.source,
      unitsPerCarton: cartonResolved.source,
    },
    warnings,
  };
}

export function inboundUnitsWithinDays(
  schedule: ForecastInboundScheduleEntry[],
  days: number,
  fromDate: Date = new Date(),
): number {
  if (days <= 0 || schedule.length === 0) return 0;

  const startMs = Date.UTC(
    fromDate.getUTCFullYear(),
    fromDate.getUTCMonth(),
    fromDate.getUTCDate(),
  );
  const endMs = startMs + days * 86400000;

  let total = 0;
  for (const entry of schedule) {
    if (!scheduleEntryUsableForPlanning(entry)) continue;
    const etaMs = Date.parse(`${entry.eta.slice(0, 10)}T00:00:00.000Z`);
    if (!Number.isFinite(etaMs)) continue;
    if (etaMs >= startMs && etaMs < endMs) {
      total += entry.units;
    }
  }
  return total;
}

export function computeProjectedStockAtArrival(params: {
  currentStock: number;
  dailyDemand: number;
  leadTimeDays: number;
  inboundSchedule?: ForecastInboundScheduleEntry[];
  monthlyForecastLines?: Array<{ monthIndex: number; forecastUnits: number }>;
}): number {
  if (params.leadTimeDays <= 0) return Math.max(0, params.currentStock);

  const today = utcTodayIso();
  const dailyDemandMode =
    params.monthlyForecastLines && params.monthlyForecastLines.length > 0
      ? {
          kind: "horizon" as const,
          monthlyLines: params.monthlyForecastLines,
          startDate: today,
        }
      : { kind: "uniform" as const, dailyDemand: params.dailyDemand };

  const sim = simulateDailyReplenishment({
    startDate: today,
    horizonDays: params.leadTimeDays,
    initialStock: params.currentStock,
    dailyDemand: dailyDemandMode,
    inboundSchedule: params.inboundSchedule,
    reorderPointUnits: Number.MAX_SAFE_INTEGER,
    safetyStockUnits: 0,
    leadTimeDays: params.leadTimeDays,
    targetCoverageDays: 90,
    monthlyPlanMonths: [],
  });

  return sim.closingStock;
}

export function computeRecommendedUnits(params: {
  replenishment: ReplenishmentParams;
  projectedStockAtArrival: number;
}): ReplenishmentRecommendationBreakdown {
  const { replenishment, projectedStockAtArrival } = params;
  const targetCoverageUnits = Math.ceil(
    replenishment.dailyDemand * replenishment.targetCoverageDays,
  );
  const rawRecommendedUnits = Math.max(
    0,
    targetCoverageUnits +
      replenishment.safetyStockUnits -
      projectedStockAtArrival,
  );

  return {
    targetCoverageUnits,
    safetyStockUnits: replenishment.safetyStockUnits,
    projectedStockAtArrival,
    rawRecommendedUnits,
    roundedRecommendedUnits: rawRecommendedUnits,
  };
}

export function applyMoqAndCartonToQuantity(
  quantity: number,
  moq: number | null,
  unitsPerCarton: number | null,
): {
  quantity: number;
  moqApplied: boolean;
  cartonMultipleApplied: boolean;
} {
  let result = quantity;
  let moqApplied = false;
  let cartonMultipleApplied = false;

  if (moq != null && moq > 0 && result < moq) {
    result = moq;
    moqApplied = true;
  }

  if (unitsPerCarton != null && unitsPerCarton > 1) {
    const before = result;
    result = Math.ceil(before / unitsPerCarton) * unitsPerCarton;
    if (result !== before) cartonMultipleApplied = true;
  } else {
    result = Math.ceil(result);
  }

  return { quantity: result, moqApplied, cartonMultipleApplied };
}
export const DEFAULT_GLOBAL_FACTORY_MOQ = 100;
