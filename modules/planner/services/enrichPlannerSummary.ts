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
import { fetchMarketplaceSalesAggregates } from "@/modules/inventory/repositories/inventoryRepository";
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

type DestinationSignal={country:string;projectedShortage:number;averageDailySales:number;daysOfCover:number|null;observedAt:string|null};

async function fetchRecommendedDestinationSignals(supabase:ReturnType<typeof createSupabaseRouteClient>,productIds:string[]):Promise<Map<string,DestinationSignal>>{
  if(!productIds.length)return new Map();
  const {data,error}=await supabase.from("v_amazon_forecast_logistics_read_model").select("producto_id,country,date,avg_daily_sales_30d,days_of_cover,projected_shortage,operational_observed_at").in("producto_id",productIds).order("date",{ascending:false}).limit(Math.max(500,productIds.length*20));
  if(error){
    console.warn("[planner/summary] destination read model unavailable; using Inventory sales fallback",error.message);
    const fallback = new Map<string,DestinationSignal>();
    try {
      const { byProductMarketplace } = await fetchMarketplaceSalesAggregates(productIds, { window30Days: 30, window90Days: 90 });
      for (const [key, sales] of Array.from(byProductMarketplace.entries())) {
        const productId = key.split("::")[0];
        const candidate:DestinationSignal = {
          country: sales.marketplaceCountry,
          projectedShortage: 0,
          averageDailySales: sales.units30 > 0 ? sales.units30 / 30 : sales.units90 / 90,
          daysOfCover: null,
          observedAt: null,
        };
        const current = fallback.get(productId);
        if (!current || candidate.averageDailySales > current.averageDailySales) fallback.set(productId, candidate);
      }
    } catch (fallbackError) {
      console.warn("[planner/summary] Inventory marketplace sales fallback unavailable", fallbackError);
    }
    return fallback;
  }
  const latestDateByProduct=new Map<string,string>();
  const grouped=new Map<string,DestinationSignal>();
  for(const row of data??[]){
    const productId=String(row.producto_id??""),country=String(row.country??"").toUpperCase(),date=String(row.date??"");
    if(!productId||!country||!date)continue;
    const latest=latestDateByProduct.get(productId);
    if(latest&&date<latest)continue;
    if(!latest||date>latest){latestDateByProduct.set(productId,date);for(const key of Array.from(grouped.keys()))if(key.startsWith(`${productId}|`))grouped.delete(key);}
    const key=`${productId}|${country}`,current=grouped.get(key)??{country,projectedShortage:0,averageDailySales:0,daysOfCover:null,observedAt:null};
    current.projectedShortage+=Number(row.projected_shortage??0);
    current.averageDailySales+=Number(row.avg_daily_sales_30d??0);
    const cover=row.days_of_cover==null?null:Number(row.days_of_cover);
    current.daysOfCover=current.daysOfCover==null?cover:cover==null?current.daysOfCover:Math.min(current.daysOfCover,cover);
    current.observedAt=String(row.operational_observed_at??"")||current.observedAt;
    grouped.set(key,current);
  }
  const result=new Map<string,DestinationSignal>();
  for(const [key,signal] of Array.from(grouped.entries())){const productId=key.split("|")[0];const previous=result.get(productId);if(!previous||signal.projectedShortage>previous.projectedShortage||(signal.projectedShortage===previous.projectedShortage&&signal.averageDailySales>previous.averageDailySales))result.set(productId,signal);}
  return result;
}

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

  const [portNames, salesWindows, puertosFabrica, destinationSignals] = await Promise.all([
    fetchPortNamesMap(portIds),
    fetchSales30And90Days(productIds, country, canal),
    fetchPuertosFabricaBySupplier(supabase, supplierIds),
    fetchRecommendedDestinationSignals(supabase,productIds),
  ]);

  const enrichedLines: EnrichedAnnualPurchasePlanLine[] =
    result.annualPurchasePlan.lines.map((line) => {
      const product = productById.get(line.productId);
      const forecast = forecastById.get(line.productId);
      const simulation = simulationById.get(line.productId);
      const sales = salesWindows.get(line.productId);
      const destinationSignal=destinationSignals.get(line.productId);

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
        currentStock: product?.stockTotal ?? 0,
        inboundConfirmed: product?.stockInboundConfirmed ?? 0,
        inboundProvisional: product?.stockInboundProvisional ?? 0,
        existingInboundDestinations: Array.from(new Set((product?.inboundSchedule??[]).filter(entry=>entry.usableForPlanning!==false).map(entry=>entry.forecastCountry).filter((value):value is string=>Boolean(value)))),
        recommendedDestination: params.country&&params.country!=="ALL"
          ? params.country
          : destinationSignal
            ? destinationSignal.projectedShortage > 0
              ? `${destinationSignal.country} · déficit ${Math.round(destinationSignal.projectedShortage)} uds`
              : `${destinationSignal.country} · mayor venta ${destinationSignal.averageDailySales.toFixed(1)} uds/día`
            : "Sin evidencia fiable por país",
        monthlyForecastUnits: forecast?.monthly.map(month=>month.forecastUnits)??[],
        monthlyInboundUnits: simulation?.months.map(month=>month.inboundUnits)??[],
        forecastMethod: forecast?.method ?? "NO_HISTORY",
        monthlyInboundDetails: (product?.inboundSchedule ?? []).map((entry) => ({
          eta: entry.eta,
          units: entry.units,
          orderId: entry.ordenId ?? null,
          orderNumber: entry.numeroOrden ?? null,
          country: entry.forecastCountry,
          channel: entry.forecastChannel,
          confidence: entry.confidence,
        })),
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
