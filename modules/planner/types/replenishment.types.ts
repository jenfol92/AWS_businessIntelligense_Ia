import type { ForecastInboundScheduleEntry } from "./forecastInbound.types";

export type ReplenishmentParamSource = string;

export type ReplenishmentDemandSource =
  | "RECENT_30D"
  | "RECENT_90D"
  | "ANNUAL_FORECAST_MONTH"
  | "ANNUAL_FORECAST_CORRECTED"
  | "ANNUAL_AVERAGE"
  | "BENCHMARK"
  | "NO_DATA";

export type ReplenishmentDemand = {
  dailyDemand: number;
  monthlyDemand: number;
  source: ReplenishmentDemandSource;
  basis: string;
  warnings: string[];
};

export type ReplenishmentParams = {
  productId: string;

  demand: ReplenishmentDemand;
  dailyDemand: number;

  productionDays: number;
  transitDays: number;
  customsDays: number;
  domesticDays: number;
  calendarDelayDays: number;

  leadTimeDays: number;

  safetyBufferDays: number;
  leadTimeDemandUnits: number;
  safetyStockUnits: number;
  reorderPointUnits: number;

  targetCoverageDays: number;

  moq: number | null;
  unitsPerCarton: number | null;

  source: {
    productionDays: ReplenishmentParamSource;
    transitDays: ReplenishmentParamSource;
    customsDays: ReplenishmentParamSource;
    safetyBufferDays: ReplenishmentParamSource;
    moq: ReplenishmentParamSource;
    unitsPerCarton: ReplenishmentParamSource;
  };

  warnings: string[];
};

export type ReplenishmentRecommendationBreakdown = {
  targetCoverageUnits: number;
  safetyStockUnits: number;
  projectedStockAtArrival: number;
  rawRecommendedUnits: number;
  roundedRecommendedUnits: number;
};

export type ReplenishmentOrderTimingStatus =
  | "OK"
  | "URGENT"
  | "DUE"
  | "OVERDUE";

export type ReplenishmentTimingCalendarEvent = {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  impactDays: number;
  affectsProduction: boolean;
  affectsTransport: boolean;
};

export type ReplenishmentTiming = {
  projectedStockoutDate: string | null;
  belowSafetyStockDate: string | null;
  belowReorderPointDate: string | null;
  requiredArrivalDate: string | null;
  latestSafeOrderDate: string | null;
  orderTodayEta: string | null;
  orderTodayCalendarDelayDays: number;
  orderTodayLostSalesBeforeArrival: number;
  orderTodayCalendarEvents: ReplenishmentTimingCalendarEvent[];
  isOrderAlreadyLate: boolean;
  /** Stock agotado ahora mismo con demanda > 0. */
  currentStockout?: boolean;
  nextInboundDate?: string | null;
  nextInboundUnits?: number;
  lostSalesUntilNextInbound?: number;
  /** Inbound confirmado llega antes que un pedido nuevo hecho hoy. */
  orderTodaySupersededByInbound?: boolean;
  orderTodaySupersededMessage?: string | null;
};

export type ReplenishmentSimulationMeta = {
  leadTimeDays: number;
  safetyBufferDays: number;
  leadTimeDemandUnits: number;
  safetyStockUnits: number;
  reorderPointUnits: number;
  belowReorderPointDate: string | null;
  belowSafetyStockDate?: string | null;
  latestOrderDate: string | null;
  estimatedStockoutDate?: string | null;
  stockoutDays?: number;
  estimatedLostSalesUnits?: number;
  projectedStockAtArrival?: number;
  replenishmentStatus: ReplenishmentOrderTimingStatus;
  timing?: ReplenishmentTiming;
  warnings: string[];
};

export type DailyReplenishmentMonthlyPlanLine = {
  month: string;
  previousYearSales: number;
  forecastUnits: number;
  openingPhysicalStock: number;
  inboundConfirmed: number;
  inboundProvisional: number;
  servedUnits: number;
  lostSalesUnits: number;
  closingPhysicalStock: number;
  stockoutDays: number;
  stockoutStartDate: string | null;
  stockoutEndDate: string | null;
  belowReorderPointDate: string | null;
  /** Primera entrada planificable del mes (confirmada / orden confirmada). */
  monthlyInboundFirstDate?: string | null;
  lostSalesBeforeFirstInbound?: number;
  servedAfterInbound?: number;
  stockAfterInbound?: number | null;
  latestOrderDate: string | null;
  recommendedPurchaseUnits: number;
  capitalRequired: number | null;
  reason: string;
};

export type PurchaseCycleReason =
  | "URGENT_REORDER"
  | "REORDER_POINT"
  | "CALENDAR_PREVENTIVE"
  | "STOCKOUT_RECOVERY";

export type PurchaseCycleStatus = "URGENT" | "OVERDUE" | "PLANNED" | "OK";

export type PurchaseCycleCalendarEvent = {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  impactDays: number;
};

export type PurchaseCycle = {
  cycleNumber: number;
  orderDate: string;
  latestOrderDate: string;
  estimatedArrivalDate: string;
  units: number;
  capitalRequired: number | null;
  /** Cobertura real del pedido (desde llegada hasta fin de stock objetivo). */
  coversFrom: string;
  coversTo: string;
  coverageDays: number;
  demandCoveredUnits: number;
  safetyBufferUnits: number;
  projectedStockoutDate: string | null;
  estimatedLostSalesBeforeArrival: number;
  projectedStockAtOrderDate: number;
  projectedStockAtArrival: number;
  calendarDelayDays: number;
  calendarEvents: PurchaseCycleCalendarEvent[];
  reason: PurchaseCycleReason;
  status: PurchaseCycleStatus;
  businessMessage: string;
  /** Ventana de demanda usada en el cálculo (ciclos preventivos). */
  demandWindowFrom?: string;
  demandWindowTo?: string;
  /** Cobertura real explícita; en preventivos >= estimatedArrivalDate. */
  effectiveCoverageFrom?: string;
  effectiveCoverageTo?: string;
  /** Si stock/inbound previo cubre el tramo demandWindowFrom → ETA. */
  stockCoverageBeforeArrival?: boolean;
  /** Última fecha cubierta por stock previo antes de la llegada. */
  stockCoveredUntilBeforeArrival?: string | null;
  /** @deprecated Usar `calendarEvents` */
  calendarWarnings?: string[];
  leadTimeDays?: number;
};

export type PurchaseCyclePlan = {
  cycles: PurchaseCycle[];
  capitalAlreadyCommitted: number | null;
  additionalCapitalRequired: number;
  totalCapitalExposure: number | null;
  /** Inbound existente usado / ignorado en la planificación. */
  planningInbound: {
    used: ForecastInboundScheduleEntry[];
    ignored: ForecastInboundScheduleEntry[];
  };
  warnings: string[];
};

export type DailyReplenishmentSimulation = {
  estimatedStockoutDate: string | null;
  stockoutStartDate: string | null;
  stockoutEndDate: string | null;
  stockoutDays: number;
  estimatedLostSalesUnits: number;
  belowReorderPointDate: string | null;
  belowSafetyStockDate: string | null;
  latestOrderDate: string | null;
  projectedStockAtArrival: number;
  closingStock: number;
  replenishmentStatus: ReplenishmentOrderTimingStatus;
  monthlyPlan: DailyReplenishmentMonthlyPlanLine[];
  purchaseCycles?: PurchaseCycle[];
  warnings: string[];
};
