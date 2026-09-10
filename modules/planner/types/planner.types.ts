/** Contexto opcional de demanda (p. ej. forecast anual ya calculado en inventario). */
export type ReplenishmentDemandOverride = {
  annualForecastMonthly?: number[];
  previousYearTotal?: number;
  recentSales30?: number;
  recentSales90?: number;
  benchmarkMonthlyUnits?: number;
  useStockoutCorrectedForecast?: boolean;
};

export type PlannerParams = {

  windowDays?: number;

  horizonMonths?: number;

  scenario?: "conservative" | "base" | "optimistic";

  country?: string;

  channel?: "AMAZON_FBA" | "AMAZON_FBM" | "ALL";

  includeNewProducts?: boolean;

    /** Limita el análisis a productos concretos cuando un consumidor lo necesita. */
    productIds?: string[];

  /** Overrides temporales por producto_id (simulación inventario). */
  forecastConfigOverrides?: Record<string, import("@/modules/planning/types").ProductForecastConfigUpsertBody>;

  /** Datos de demanda enriquecidos por producto (forecast anual, ventas recientes). */
  replenishmentDemandOverrides?: Record<string, ReplenishmentDemandOverride>;

};

export type DemandForecastScenario = "conservative" | "base" | "optimistic";

export type DemandForecastMonthlyLine = {
  monthIndex: number;
  forecastUnits: number;
  scenario: DemandForecastScenario;
  seasonalityFactor: number;
};

export type DemandForecastResult = {
  productId: string;
  sku: string;
  method: "HISTORICAL_SIMPLE" | "NO_HISTORY" | "NEW_PRODUCT_BENCHMARK";
  averageDailySales: number;
  monthly: DemandForecastMonthlyLine[];
};

export type SupplySimulationMonthlyLine = {
  monthIndex: number;
  forecastUnits: number;
  openingStock: number;
  inboundUnits: number;
  inboundUnitsProvisional?: number;
  closingStock: number;
  stockout: boolean;
  servedUnits?: number;
  lostSalesUnits?: number;
  stockoutDays?: number;
};

export type SupplySimulationResult = {
  productId: string;
  sku: string;
  months: SupplySimulationMonthlyLine[];
  stockoutMonthIndex: number | null;
  estimatedStockoutDate: string | null;
  recommendedOrderDate: string | null;
  needsReplenishment: boolean;
  targetCoverageDays: number;
  replenishment?: import("./replenishment.types").ReplenishmentSimulationMeta;
  dailySimulation?: import("./replenishment.types").DailyReplenishmentSimulation;
};

export type RecommendationReasonCode =
  | "STOCKOUT_RISK"
  | "LOW_COVERAGE"
  | "LEAD_TIME_REQUIRED"
  | "SALES_SPIKE"
  | "SEASONALITY"
  | "CHINESE_NEW_YEAR"
  | "NEW_PRODUCT_BENCHMARK"
  | "NO_HISTORY_FALLBACK";

export type AnnualPurchasePlanLine = {
  productId: string;
  sku: string;
  productName?: string;

  recommendedOrderUnits: number;
  recommendedOrderDate: string | null;
  estimatedArrivalDate: string | null;

  targetCoverageDays: number;
  expectedCoverageDaysAfterOrder: number | null;

  moqApplied: boolean;
  cartonMultipleApplied: boolean;

  cbmTotal: number | null;
  weightKgTotal: number | null;

  unitPurchaseCost: number | null;
  purchaseCapitalRequired: number | null;
  estimatedRevenueAtSalePrice: number | null;
  estimatedGrossMarginValue: number | null;

  supplierId?: string | null;
  supplierName?: string | null;
  agentId?: string | null;
  agentName?: string | null;

  originPortId?: string | null;
  consolidationEligible: boolean;

  orderTimingStatus: "ON_TIME" | "DUE_NOW" | "OVERDUE";
  daysLate: number;

  recommendationBreakdown?: import("./replenishment.types").ReplenishmentRecommendationBreakdown;
  replenishmentWarnings?: string[];
};

/** Línea enriquecida para UI y API summary (nombres legibles + explicación). */
export type EnrichedAnnualPurchasePlanLine = AnnualPurchasePlanLine & {
  currentStock: number;
  inboundConfirmed: number;
  inboundProvisional: number;
  existingInboundDestinations: string[];
  recommendedDestination: string;
  monthlyForecastUnits: number[];
  monthlyInboundUnits: number[];
  forecastMethod: DemandForecastResult["method"];
  monthlyInboundDetails: Array<{
    eta: string;
    units: number;
    orderId: string | null;
    orderNumber: string | null;
    country: string | null;
    channel: string;
    confidence: "confirmed" | "provisional";
  }>;
  /** Puerto preferido del proveedor (proveedores.puerto_preferido_id → puertos_china). */
  supplierPreferredPortId: string | null;
  supplierPreferredPortName: string;
  /** Alias UI: mismo valor que supplierPreferredPortName. */
  displayPortName: string;
  agentContact: string;
  recommendationReasonCode: RecommendationReasonCode;
  recommendationReasonLabel: string;
  recommendationExplanation: string;
  businessImpact: string;
  urgencyLabel: "Crítico" | "Urgente" | "Planificado" | "Observación";
  urgencyScore: number;
  latestSafeOrderDate: string | null;
  readableTiming: string;
};

export type EnrichedPortGroupSummary = {
  originPortId: string | null;
  originPortName: string;
  canConsolidate: boolean;
  consolidationStatus: PortPurchaseGroup["consolidationStatus"];
  consolidationWarnings: string[];
  reason: string;
  consolidationLabel: string;
  totalProducts: number;
  separatedCount: number;
  supplierCount: number;
  totalCbm: number;
  totalWeightKg: number;
  groupedProductNames: string[];
  separatedProductNames: string[];
  products: Array<{ productId: string; sku: string; productName: string }>;
};

export type ContainerGroupStatus =
  | "GOOD_CANDIDATE"
  | "LOW_VOLUME"
  | "EXCEEDS"
  | "REVIEW_REQUIRED"
  | "NOT_CONSOLIDABLE";

export type ContainerGroupProduct = {
  productId: string;
  sku: string;
  productName: string;
  recommendedUnits: number;
  cbmTotal: number;
  weightKgTotal: number | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierPreferredPortId: string | null;
  supplierPreferredPortName: string;
  distanceKmToRecommendedPort: number | null;
  inclusionReason: string;
  recommendationReasonLabel: string;
  readableTiming: string;
  agentId: string | null;
};

export type ContainerGroupExcludedProduct = {
  productId: string;
  sku: string;
  productName: string;
  reason: string;
};

export type RecommendedPortReason =
  | "Puerto compartido por las fábricas"
  | "Puerto mayoritario por CBM"
  | "Menor distancia media ponderada"
  | "Requiere revisión manual";

export type ContainerOptimizationGroup = {
  groupId: string;
  recommendedPortId: string | null;
  recommendedPortName: string;
  recommendedPortReason: RecommendedPortReason;
  status: ContainerGroupStatus;
  statusLabel: string;
  canCreateDraftOrder: boolean;
  cbmTotal: number;
  containerCapacityCbm: number;
  fillRate: number;
  capitalRequired: number;
  totalProducts: number;
  totalSuppliers: number;
  sharedAgentId: string | null;
  agentContact: string;
  warnings: string[];
  explanation: string;
  products: ContainerGroupProduct[];
  excludedProducts: ContainerGroupExcludedProduct[];
};

export type PlannerExecutiveStats = {
  count: number;
  annualProductsToOrder: number;
  overduePurchaseLines: number;
  dueNowPurchaseLines: number;
  annualRecommendedUnits: number;
  annualRecommendedCbm: number;
  annualRecommendedWeightKg: number;
  stockoutProducts: number;
  criticalLines: number;
  dueThisWeekLines: number;
  chineseNewYearRiskLines: number;
  salesSpikeLines: number;
  lowCoverageLines: number;
  totalPurchaseCapitalRequired: number;
  capitalAlreadyCommitted?: number;
  additionalCapitalRequired?: number;
  totalCapitalExposure?: number;
  earliestCriticalDate: string | null;
  suggestedContainerGroups: number;
  goodCandidateGroups: number;
  exceedsCapacityGroups: number;
  nonConsolidatableProducts: number;
};

export type AnnualPurchasePlanResult = {
  lines: AnnualPurchasePlanLine[];
  totalRecommendedUnits: number;
  totalRecommendedCbm: number;
  totalRecommendedWeightKg: number;
  productsToOrder: number;
  totalPurchaseCapitalRequired: number;
  totalEstimatedRevenueAtSalePrice: number;
  totalEstimatedGrossMarginValue: number;
  capitalAlreadyCommitted: number;
  additionalCapitalRequired: number;
  totalCapitalExposure: number;
};

export type CompetitorBenchmarkRow = {
  productoId?: string | null;
  candidateSku?: string | null;
  marketplaceCountry: string;
  competitorAsin: string;
  competitorTitle?: string | null;
  snapshotDate: string;
  price?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  estimatedMonthlyUnits?: number | null;
  estimatedMonthlyRevenue?: number | null;
  bsr?: number | null;
  source: string;
};



/**

 * Restricciones logísticas relevantes para el planner.

 * Valores por defecto conservadores cuando la fila en BD aún no está mapeada.

 */

export type PlannerLogisticsRestriction = {
  contieneBaterias: boolean;
  tipoBateria?: string | null;
  unNumber?: string | null;
  claseMercanciaPeligrosa?: string | null;
  requiereDgd: boolean;
  requiereAprobacionTransportista: boolean;
  permiteConsolidacionMixta: boolean;
  forzarEnvioSeparado: boolean;
  allowsConsolidation: boolean;
};


export type PlanningProduct = {

  id: string;

  sku: string;

  nombre?: string;

  asin?: string | null;

  country: string;

  /**

   * Canal Amazon para el objeto de planificación.

   * Si `PlannerParams.channel` es `ALL`, las ventas se agregan de todos los `canal_venta`

   * en `ventas_diarias` y aquí se fija `AMAZON_FBA` como etiqueta por compatibilidad.

   */

  channel: "AMAZON_FBA" | "AMAZON_FBM";



  categoryId?: string | null;

  subcategoryId?: string | null;

  brand?: string | null;



  salesUnits: number;

  salesAmount?: number;

  windowDays: number;



  stockTotal: number;

  stockReserved?: number;

  stockInboundConfirmed?: number;

  stockInboundProvisional?: number;

  stockInboundPlanned?: number;

  inboundSchedule?: import("./forecastInbound.types").ForecastInboundScheduleEntry[];

  capitalAlreadyCommitted?: number;



  purchaseCost?: number;

  salePrice?: number;

  marginPct?: number;



  supplierId?: string | null;

  supplierName?: string | null;

  agentId?: string | null;

  agentName?: string | null;

  factoryId?: string | null;

  originPortId?: string | null;

  originPortDistanceKmRoad?: number | null;

  originPortDistanceKmStraight?: number | null;



  leadTimeProductionDays?: number;

  leadTimeSeaDays?: number;

  leadTimeLandDays?: number;



  moq?: number | null;

  cartonMultiple?: number | null;

  cbmPerUnit?: number | null;

  weightKg?: number | null;



  isNewProduct?: boolean;

  launchDate?: string | null;

  /** Perfil de estacionalidad; `evergreen` si no hay dato en BD. */

  seasonalityProfile?: string | null;

  familyKey?: string | null;



  logisticsRestriction?: PlannerLogisticsRestriction;

};

export type PortPurchasePlan = {
  portGroups: PortPurchaseGroup[];
};

export type PortPurchaseGroup = {
  originPortId: string | null;
  products: PlanningProduct[];
  consolidableProducts: PlanningProduct[];
  separatedProducts: PlanningProduct[];
  canConsolidate: boolean;
  consolidationStatus: "SUGGESTED" | "REVIEW" | "BLOCKED";
  consolidationWarnings: string[];
  reason: string;
};
