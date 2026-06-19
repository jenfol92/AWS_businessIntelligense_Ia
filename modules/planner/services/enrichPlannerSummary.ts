/**
 * Enriquece el resultado de analyzeProducts con nombres legibles,
 * insights de recomendación y grupos de consolidación para la UI.
 */

import {
  fetchPortNamesMap,
  fetchPuertosFabricaBySupplier,
  fetchSales30And90Days,
  fetchSuppliersMap,
  resolveAgentContact,
  resolvePortDisplayName,
  resolveSupplierPreferredPort,
} from "../repositories/plannerRepository";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type {
  AnnualPurchasePlanResult,
  ContainerOptimizationGroup,
  DemandForecastResult,
  EnrichedAnnualPurchasePlanLine,
  EnrichedPortGroupSummary,
  PlannerExecutiveStats,
  PlannerParams,
  PlanningProduct,
  PortPurchaseGroup,
  SupplySimulationResult,
} from "../types/planner.types";
import { buildContainerOptimizationGroups } from "./buildContainerOptimizationGroups";
import { buildRecommendationInsights } from "./buildRecommendationInsights";

const UNKNOWN_PORT_KEY = "UNKNOWN_PORT";

type AnalyzeResult = {
  annualPurchasePlan: AnnualPurchasePlanResult;
  purchasePlan: { portGroups: PortPurchaseGroup[] };
  forecasts: DemandForecastResult[];
  simulations: SupplySimulationResult[];
  stats: {
    count?: number;
    overduePurchaseLines?: number;
    dueNowPurchaseLines?: number;
    stockoutProducts?: number;
    [key: string]: string | number | null | undefined;
  };
};

function consolidationLabel(group: PortPurchaseGroup): string {
  if (group.canConsolidate && group.consolidationWarnings.length === 0) {
    return "Consolidable";
  }
  if (group.canConsolidate && group.consolidationWarnings.length > 0) {
    return "Consolidación parcial";
  }
  if (
    group.consolidableProducts.length >= 2 &&
    group.separatedProducts.length > 0
  ) {
    return "Consolidación parcial";
  }
  return "No consolidable";
}

function productDisplayName(p: PlanningProduct): string {
  return (p.nombre ?? p.sku ?? "Producto").trim();
}

function buildPortGroupSummary(
  group: PortPurchaseGroup,
  portNames: Map<string, string>,
  annualLinesByProduct: Map<string, EnrichedAnnualPurchasePlanLine>,
): EnrichedPortGroupSummary {
  const originPortId =
    group.originPortId === UNKNOWN_PORT_KEY ? null : group.originPortId;

  let totalCbm = 0;
  let totalWeightKg = 0;
  for (const p of group.products) {
    const line = annualLinesByProduct.get(p.id);
    if (line) {
      totalCbm += line.cbmTotal ?? 0;
      totalWeightKg += line.weightKgTotal ?? 0;
    }
  }

  const supplierIds = new Set(
    group.products.map((p) => p.supplierId).filter(Boolean),
  );

  return {
    originPortId,
    originPortName: resolvePortDisplayName(group.originPortId, portNames),
    canConsolidate: group.canConsolidate,
    consolidationStatus: group.consolidationStatus,
    consolidationWarnings: group.consolidationWarnings,
    reason: group.reason,
    consolidationLabel: consolidationLabel(group),
    totalProducts: group.products.length,
    separatedCount: group.separatedProducts.length,
    supplierCount: supplierIds.size,
    totalCbm,
    totalWeightKg,
    groupedProductNames: group.consolidableProducts.map(productDisplayName),
    separatedProductNames: group.separatedProducts.map(productDisplayName),
    products: group.products.map((p) => ({
      productId: p.id,
      sku: p.sku,
      productName: productDisplayName(p),
    })),
  };
}

export async function enrichPlannerSummary(
  result: AnalyzeResult,
  params: PlannerParams,
  agentsMap: Map<string, { id: string; empresa: string | null; contacto: string | null }>,
): Promise<{
  lines: EnrichedAnnualPurchasePlanLine[];
  portGroups: EnrichedPortGroupSummary[];
  containerGroups: ContainerOptimizationGroup[];
  stats: PlannerExecutiveStats;
}> {
  const products = result.purchasePlan.portGroups.flatMap((g) => g.products);
  const productById = new Map(products.map((p) => [p.id, p]));
  const forecastById = new Map(result.forecasts.map((f) => [f.productId, f]));
  const simulationById = new Map(result.simulations.map((s) => [s.productId, s]));

  const supplierIds = Array.from(
    new Set(
      result.annualPurchasePlan.lines
        .map((l) => l.supplierId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const supabase = createSupabaseRouteClient();
  const suppliersMap = await fetchSuppliersMap(supabase, supplierIds);

  const portIds = Array.from(
    new Set(
      [
        ...result.annualPurchasePlan.lines.map((l) => l.originPortId),
        ...result.purchasePlan.portGroups.map((g) => g.originPortId),
        ...Array.from(suppliersMap.values()).map((s) => s.puerto_preferido_id),
      ].filter((id): id is string => Boolean(id)),
    ),
  );

  const productIds = result.annualPurchasePlan.lines.map((l) => l.productId);
  const country = params.country ?? "ALL";
  const canal =
    params.channel === "AMAZON_FBM"
      ? "AMAZON_FBM"
      : params.channel === "AMAZON_FBA"
        ? "AMAZON_FBA"
        : null;

  const [portNames, salesWindows, puertosFabrica] = await Promise.all([
    fetchPortNamesMap(portIds),
    fetchSales30And90Days(productIds, country, canal),
    fetchPuertosFabricaBySupplier(supabase, supplierIds),
  ]);

  const enrichedLines: EnrichedAnnualPurchasePlanLine[] =
    result.annualPurchasePlan.lines.map((line) => {
      const product = productById.get(line.productId);
      const forecast = forecastById.get(line.productId);
      const simulation = simulationById.get(line.productId);
      const sales = salesWindows.get(line.productId);

      const insights =
        product && forecast && simulation
          ? buildRecommendationInsights({
              line,
              product,
              forecast,
              simulation,
              salesLast30Days: sales?.sales30,
              salesAvgDaily90Days:
                sales && sales.sales90 > 0 ? sales.sales90 / 90 : undefined,
            })
          : {
              recommendationReasonCode: "NO_HISTORY_FALLBACK" as const,
              recommendationReasonLabel: "Sin histórico suficiente",
              recommendationExplanation:
                "No se pudo calcular el motivo detallado para esta línea.",
              businessImpact:
                "Revise stock y ventas del producto antes de confirmar el pedido.",
              urgencyLabel: "Observación" as const,
              urgencyScore: 20,
              latestSafeOrderDate: line.recommendedOrderDate,
              readableTiming:
                line.orderTimingStatus === "OVERDUE" && line.daysLate > 0
                  ? `Debió pedirse hace ${line.daysLate} días`
                  : line.orderTimingStatus === "DUE_NOW"
                    ? "Pedir esta semana"
                    : line.recommendedOrderDate
                      ? `Planificado para ${line.recommendedOrderDate}`
                      : "Sin fecha definida",
            };

      const preferredPort = resolveSupplierPreferredPort(
        line.supplierId,
        suppliersMap,
        portNames,
      );

      return {
        ...line,
        supplierPreferredPortId: preferredPort.id,
        supplierPreferredPortName: preferredPort.name,
        displayPortName: preferredPort.name,
        agentContact: resolveAgentContact(line.agentId, agentsMap),
        ...insights,
      };
    });

  const linesByProduct = new Map(
    enrichedLines.map((l) => [l.productId, l]),
  );

  const portGroups = result.purchasePlan.portGroups.map((g) =>
    buildPortGroupSummary(g, portNames, linesByProduct),
  );

  const containerGroups = buildContainerOptimizationGroups({
    lines: enrichedLines,
    productsById: productById,
    suppliersById: suppliersMap,
    portNames,
    puertosFabrica,
  });

  const criticalLines = enrichedLines.filter((l) => l.urgencyLabel === "Crítico").length;
  const dueThisWeekLines = enrichedLines.filter(
    (l) => l.orderTimingStatus === "DUE_NOW",
  ).length;
  const chineseNewYearRiskLines = enrichedLines.filter(
    (l) => l.recommendationReasonCode === "CHINESE_NEW_YEAR",
  ).length;
  const salesSpikeLines = enrichedLines.filter(
    (l) => l.recommendationReasonCode === "SALES_SPIKE",
  ).length;
  const lowCoverageLines = enrichedLines.filter(
    (l) =>
      l.recommendationReasonCode === "LOW_COVERAGE" ||
      l.recommendationReasonCode === "STOCKOUT_RISK",
  ).length;

  const criticalDates = enrichedLines
    .filter((l) => l.urgencyLabel === "Crítico" || l.urgencyLabel === "Urgente")
    .map((l) => l.recommendedOrderDate)
    .filter((d): d is string => Boolean(d));
  const earliestCriticalDate =
    criticalDates.length === 0
      ? null
      : criticalDates.reduce((a, b) => (a < b ? a : b));

  const stats: PlannerExecutiveStats = {
    count: result.stats.count ?? 0,
    annualProductsToOrder: result.annualPurchasePlan.productsToOrder,
    overduePurchaseLines: result.stats.overduePurchaseLines ?? 0,
    dueNowPurchaseLines: result.stats.dueNowPurchaseLines ?? 0,
    annualRecommendedUnits: result.annualPurchasePlan.totalRecommendedUnits,
    annualRecommendedCbm: result.annualPurchasePlan.totalRecommendedCbm,
    annualRecommendedWeightKg:
      result.annualPurchasePlan.totalRecommendedWeightKg,
    stockoutProducts: result.stats.stockoutProducts ?? 0,
    criticalLines,
    dueThisWeekLines,
    chineseNewYearRiskLines,
    salesSpikeLines,
    lowCoverageLines,
    totalPurchaseCapitalRequired:
      result.annualPurchasePlan.totalPurchaseCapitalRequired,
    capitalAlreadyCommitted:
      result.annualPurchasePlan.capitalAlreadyCommitted,
    additionalCapitalRequired:
      result.annualPurchasePlan.additionalCapitalRequired,
    totalCapitalExposure: result.annualPurchasePlan.totalCapitalExposure,
    earliestCriticalDate,
    suggestedContainerGroups: containerGroups.length,
    goodCandidateGroups: containerGroups.filter((g) => g.status === "GOOD_CANDIDATE").length,
    exceedsCapacityGroups: containerGroups.filter((g) => g.status === "EXCEEDS").length,
    nonConsolidatableProducts: containerGroups
      .filter((g) => g.status === "NOT_CONSOLIDABLE")
      .reduce((s, g) => s + g.totalProducts, 0),
  };

  return { lines: enrichedLines, portGroups, containerGroups, stats };
}
