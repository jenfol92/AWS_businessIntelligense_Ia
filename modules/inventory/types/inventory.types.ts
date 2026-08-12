// modules/inventory/types/inventory.types.ts
//
// Tipos del módulo Inventario: dashboard, detalle por producto, forecast e inbound.

import type { DemandForecastResult } from "@/modules/planner/types/planner.types";
import type { ProductForecastConfigUpsertBody } from "@/modules/planning/types";
import type { ForecastMethodInfo } from "../services/buildForecastMethodInfo";

export type InventoryRiskLevel = "critico" | "bajo" | "ok" | "sin_ventas";

export type InventoryForecastMethod =
  | "HISTORICAL_SIMPLE"
  | "NEW_PRODUCT_BENCHMARK"
  | "FAMILY_VARIANT_BENCHMARK"
  | "NO_HISTORY";

export type AnnualForecastReason =
  | "PREVIOUS_YEAR_SEASONAL"
  | "NEW_PRODUCT_BENCHMARK"
  | "FAMILY_VARIANT_BENCHMARK"
  | "STOCKOUT_RISK"
  | "LOW_STOCK"
  | "NO_HISTORY"
  | "MANUAL_FORECAST_PENDING"
  | "BENCHMARK_UNAVAILABLE";

export type AnnualForecastMonthlyLine = {
  country: string;
  channel: string;
  month: number;
  previousYearSalesUnits: number;
  forecastSalesUnits: number;
  /** @deprecated Use openingPhysicalStock */
  openingStock: number;
  openingPhysicalStock: number;
  inboundUnits: number;
  inboundUnitsProvisional?: number;
  servedUnits: number;
  lostSalesUnits: number;
  /** @deprecated Use closingPhysicalStock */
  projectedEndingStock: number;
  closingPhysicalStock: number;
  stockoutDays: number;
  stockoutStartDate: string | null;
  stockoutEndDate: string | null;
  belowReorderPointDate: string | null;
  /** Primera entrada planificable del mes; aclara pérdidas previas a la llegada. */
  monthlyInboundFirstDate?: string | null;
  lostSalesBeforeFirstInbound?: number;
  servedAfterInbound?: number;
  stockAfterInbound?: number | null;
  latestOrderDate: string | null;
  recommendedPurchaseUnits: number;
  capitalRequired: number | null;
  reason: AnnualForecastReason;
  /** Corrección histórica por rotura (OWN_SALES_CORRECTED). */
  historicalDaysWithStock?: number;
  historicalStockoutDays?: number;
  correctedForecastUnits?: number;
  historicalLostDemandUnits?: number;
  correctionConfidence?: "HIGH" | "MEDIUM" | "LOW";
  correctionWarning?: string;
  /** Mes ya transcurrido; no es plan operativo. */
  isPastMonth?: boolean;
  isOperationalMonth?: boolean;
};

export type AnnualInventorySimulationSummary = {
  estimatedStockoutDate: string | null;
  stockoutDays: number;
  estimatedLostSalesUnits: number;
  belowReorderPointDate: string | null;
  belowSafetyStockDate: string | null;
  latestOrderDate: string | null;
  projectedStockAtArrival: number;
  replenishmentStatus: string;
  timing?: import("@/modules/planner/types/replenishment.types").ReplenishmentTiming;
};

export type AnnualInventoryForecast = {
  method: InventoryForecastMethod;
  country: string;
  channel: string;
  baseYear: number;
  forecastYear: number;
  previousYearTotalUnits: number;
  currentOpeningStock: number;
  monthlyPlan: AnnualForecastMonthlyLine[];
  simulationSummary?: AnnualInventorySimulationSummary;
  purchaseCycles?: import("@/modules/planner/types/replenishment.types").PurchaseCycle[];
  purchaseCyclePlan?: import("@/modules/planner/types/replenishment.types").PurchaseCyclePlan;
  stockoutCorrection?: import("@/modules/planner/types/stockoutCorrection.types").StockoutCorrectionResult;
  stockoutCorrectionDebug?: import("@/modules/planner/types/stockoutCorrection.types").StockoutCorrectionDebugPayload;
  warnings: string[];
  methodInfo?: ForecastMethodInfo;
};

export type InventoryExplanationCode =
  | "STOCK_ZERO"
  | "LOW_COVERAGE"
  | "NO_HISTORY"
  | "BENCHMARK_AVAILABLE"
  | "BENCHMARK_PENDING"
  | "HISTORICAL_FORECAST";

export type InventoryCountryStockRow = {
  pais: string;
  /** FBA sellable stock from latest Inventory Ledger location snapshot. */
  stockFba: number;
  /** FBA unsellable stock from latest Inventory Ledger location snapshot. */
  stockFbaUnsellable: number;
  /** FBA sellable + unsellable physical stock from latest Inventory Ledger. */
  stockFbaPhysicalTotal: number;
  /** Legacy/persisted country FBA stock kept for audit comparisons. */
  stockFbaApp: number;
  stockFbaLedgerSnapshotDate: string | null;
  stockFbaLastImportedAt: string | null;
  stockFbaLedgerStale: boolean;
  stockFbaLedgerStaleDays: number | null;
  stockFbm: number;
  stockTotal: number;
  /** FBA shipped units by customer delivery country (ventas_diarias.pais). */
  salesUnitsPeriod: number;
  salesUnits30: number;
  salesUnits90: number;
  /** FBA shipped units grouped by Amazon sales marketplace (raw sales-channel). */
  marketplaceSalesUnits30: number;
  marketplaceSalesUnits90: number;
  marketplaceSalesAmount30: number;
  marketplaceSalesAmount90: number;
  marketplaceSalesChannels: string[];
  marketplaceDeliveryBreakdown: MarketplaceDeliveryBreakdown[];
  avgDailyPeriod: number;
  avgDaily30: number;
  avgDaily90: number;
  coverageDays: number | null;
  risk: InventoryRiskLevel;
  priceToday?: number | null;
  priceTodayUnits?: number | null;
  priceTopPeriod?: number | null;
  priceTopPeriodUnits?: number | null;
  priceTop30d?: number | null;
  priceTop30dUnits?: number | null;
  priceTop90d?: number | null;
  priceTop90dUnits?: number | null;
};

export type InventoryCountryPriceChannel = "ALL" | "FBA" | "FBM";

export type InventoryCountryPriceDistributionRow = {
  unitPrice: number;
  units: number;
  grossAmount: number;
  percentageUnits?: number;
  lastSaleDate: string | null;
  source: string;
};

export type InventoryProductSummary = {
  productoId: string;
  parentId: string | null;
  sku: string;
  nombre: string;
  estado: string | null;
  categoria: string | null;
  imagenUrl: string | null;
  proveedorId: string | null;
  proveedorNombre: string | null;
  stockTotal: number;
  stockFba: number;
  stockFbm: number;
  stockFbaOperationalSource?: string | null;
  stockFbaLatestSnapshot?: number | null;
  stockFbaLatestSnapshotAt?: string | null;
  stockOperationalTotal?: number | null;
  stockOperationalSource?: string | null;
  hasFbaSnapshot?: boolean;
  salesUnitsPeriod: number;
  salesUnits30: number;
  salesUnits90: number;
  coverageDays: number | null;
  risk: InventoryRiskLevel;
  hasHistory: boolean;
  hasInbound: boolean;
  hasBenchmark: boolean;
  forecastMethod: InventoryForecastMethod | null;
  variantes: InventoryProductSummary[];
};

export type InventoryDashboardSummary = {
  totalProducts: number;
  productsAtRisk: number;
  productsStockZero: number;
  productsNoHistory: number;
  productsWithInbound: number;
};

export type InventoryComparisonResponse = {
  ok: true;
  products: InventoryProductSummary[];
  summary: InventoryDashboardSummary;
  categorias: string[];
  proveedores: string[];
};

export type InventoryDiagnosticsSyncStatus = {
  jobKey: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastRowsUpserted: number | null;
  nextRunHint: string | null;
} | null;

export type InventoryProductDiagnostics = {
  productId: string;
  sku: string;
  nombre: string;
  hasFbaSnapshot: boolean;
  fbaSnapshotUnits: number | null;
  fbaSnapshotAt: string | null;
  fbaSnapshotSource: string | null;
  legacyFbaUnits: number;
  legacyFbmUnits: number;
  legacyTotalUnits: number;
  fbaDifferenceUnits: number | null;
  fbaDifferenceSeverity: "ok" | "warning" | "critical";
  sales30Units: number;
  sales60Units: number;
  sales90Units: number;
  hasRecentSales: boolean;
  hasSalesPreviousYear: boolean;
  previousYearUnits: number;
  hasLedger: boolean;
  ledgerUnits: number | null;
  ledgerDate: string | null;
  hasInbound: boolean;
  inboundUnits: number;
  hasAmazonInbound: boolean;
  amazonShipmentIds: string[];
  hasBenchmark: boolean;
  hasSupplyConfig: boolean;
  missingData: string[];
  warnings: string[];
  recommendedActions: string[];
};

export type InventoryDiagnosticsResponse = {
  ok: true;
  generatedAt: string;
  syncStatus: Record<string, InventoryDiagnosticsSyncStatus>;
  summary: {
    totalProducts: number;
    productsWithoutFbaSnapshot: number;
    productsWithoutRecentSales: number;
    productsWithoutPreviousYearSales: number;
    productsWithFbaDifference: number;
    productsWithInbound: number;
    productsWithAmazonInbound: number;
    productsUsingLegacyFbm: number;
  };
  products: InventoryProductDiagnostics[];
};

export type InventoryInboundConfidence = "confirmed" | "provisional";

export type InventoryInboundPlanningKind =
  | "CONTAINER_CONFIRMED"
  | "PURCHASE_ORDER_CONFIRMED"
  | "PURCHASE_ORDER_PROVISIONAL";

export type InventoryInboundRow = {
  ordenId: string;
  ordenItemId?: string;
  numeroOrden: string | null;
  numeroPedidoAgente: string | null;
  contenedorId: string | null;
  contenedorIdentificador: string | null;
  logisticsKind?: "contenedor_propio" | "amazon_inbound" | "none";
  seguimiento?: string | null;
  amazonShipmentId?: string | null;
  amazonShipmentName?: string | null;
  amazonStatus?: string | null;
  amazonDestinationCenter?: string | null;
  destinoOrden?: string | null;
  eta: string | null;
  etaSource: "container" | "order_real" | "order" | null;
  cantidadPendiente: number;
  unidadesOrden?: number;
  unidadesAplicadas?: number;
  estado: string;
  loteProducto: string | null;
  confidence?: InventoryInboundConfidence;
  planningKind?: InventoryInboundPlanningKind;
  usableForPlanning?: boolean;
  retrasoDias?: number;
  costeUnitarioEur?: number;
  forecastCountry?: string | null;
  forecastChannel?: string | null;
  warnings?: string[];
};

export type InventoryLoteRow = {
  lote: string;
  unidades: number;
  costoUnitario: number | null;
  costoTotal: number | null;
  fecha: string | null;
  contenedorIdentificador: string | null;
  paisDestino: string | null;
};

export type InventoryLotesResponse = {
  ok: true;
  lotes: InventoryLoteRow[];
  resumen: {
    totalUnidades: number;
    costoTotal: number;
    costoMedioUnitario: number | null;
  };
};

export type InventoryForecastExplanation = {
  code: InventoryExplanationCode;
  label: string;
  detail: string;
};

export type InventoryForecastReplenishmentSummary = {
  leadTimeDays: number;
  productionDays: number;
  transitDays: number;
  customsDays: number;
  safetyBufferDays: number;
  leadTimeDemandUnits: number;
  safetyStockUnits: number;
  reorderPointUnits: number;
  latestOrderDate: string | null;
  belowReorderPointDate: string | null;
  belowSafetyStockDate?: string | null;
  estimatedStockoutDate?: string | null;
  stockoutDays?: number;
  estimatedLostSalesUnits?: number;
  projectedStockAtArrival?: number;
  recommendedOrderUnits?: number | null;
  additionalCapitalRequired?: number | null;
  replenishmentStatus: string;
  currentStock?: number;
  calendarDelayDays?: number;
  effectiveForecastMethod?: string;
  dailyDemand?: number;
  demandSource?: string;
  demandBasis?: string;
  calendarWarnings?: string[];
  purchaseCycles?: import("@/modules/planner/types/replenishment.types").PurchaseCycle[];
  timing?: import("@/modules/planner/types/replenishment.types").ReplenishmentTiming;
  orderTodayEta?: string | null;
  orderTodayLostSalesBeforeArrival?: number;
  orderTodayCalendarDelayDays?: number;
  requiredArrivalDate?: string | null;
  latestSafeOrderDate?: string | null;
  isOrderAlreadyLate?: boolean;
  currentStockout?: boolean;
  nextInboundDate?: string | null;
  nextInboundUnits?: number;
  lostSalesUntilNextInbound?: number;
  orderTodaySupersededByInbound?: boolean;
  orderTodaySupersededMessage?: string | null;
  warnings: string[];
};

export type InventoryForecastPanel = {
  method: InventoryForecastMethod;
  averageDailySales: number;
  forecastUnitsMonth1: number;
  recommendedOrderUnits: number | null;
  recommendedOrderDate: string | null;
  needsReplenishment: boolean;
  explanations: InventoryForecastExplanation[];
  plannerForecast: DemandForecastResult | null;
  methodInfo?: ForecastMethodInfo;
  replenishment?: InventoryForecastReplenishmentSummary;
};

export type InventoryProductDetailResponse = {
  ok: true;
  product: InventoryProductSummary;
  countries: InventoryCountryStockRow[];
  inbound: InventoryInboundRow[];
  inboundUnitsTotal: number;
  inboundUnitsConfirmedTotal?: number;
  inboundUnitsProvisionalTotal?: number;
  stockSuggestion: {
    diasCobertura: number | null;
    unidadesAPedir: number;
    riesgo: string | null;
    leadTimeDays: number | null;
  } | null;
  forecast: InventoryForecastPanel;
  annualForecast: AnnualInventoryForecast;
  /** Stock operativo (ledger FBA + FBM app) vs inventario_paises. */
  operationalStock?: OperationalStockSummary;
  recentWindowDays: number;
  /** true cuando el detalle se calculó con overrides temporales (query params). */
  simulationActive?: boolean;
  appliedForecastConfig?: ProductForecastConfigUpsertBody;
  periodLabel: string;
  periodDays: number;
  periodFrom: string;
  periodTo: string;
};

export type InventoryComparisonParams = {
  q?: string;
  categoria?: string;
  proveedor?: string;
  canal?: string;
  soloCriticos?: boolean;
  stockZero?: boolean;
  sinHistorico?: boolean;
  conInbound?: boolean;
};

export type ProductBaseRow = {
  id: string;
  sku: string;
  nombre: string | null;
  estado: string | null;
  proveedor_id: string | null;
  parent_id: string | null;
  stock_seguridad_minimo: number | null;
};

export type InventoryRow = {
  producto_id: string;
  pais: string;
  stock_fba: number | null;
  stock_fbm: number | null;
  stock_pais: number | null;
  updated_at?: string | null;
};

export type OperationalStockSummary = import("../services/resolveOperationalStock").OperationalStockSummary;

export type SalesAgg = {
  unitsPeriod: number;
  units30: number;
  units90: number;
};

export type FbaInventoryCountryStockRow = {
  productoId: string;
  pais: string;
  snapshotDate: string;
  lastImportedAt: string | null;
  stockSellable: number;
  stockUnsellable: number;
  stockTotal: number;
  isStale: boolean;
  staleDays: number | null;
  dispositions: Array<{
    disposition: string;
    stock: number;
  }>;
};

export type SalesByProductCountry = Map<string, SalesAgg>;

export type MarketplaceDeliveryBreakdown = {
  shipCountry: string;
  units30: number;
  units90: number;
  amount30: number;
  amount90: number;
};

export type MarketplaceSalesAgg = {
  marketplaceCountry: string;
  salesChannels: string[];
  units30: number;
  units90: number;
  amount30: number;
  amount90: number;
  deliveryBreakdown: MarketplaceDeliveryBreakdown[];
};

export type MarketplaceSalesByProductCountry = Map<string, MarketplaceSalesAgg>;
