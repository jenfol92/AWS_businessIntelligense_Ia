import type {
  EnrichedAnnualPurchasePlanLine,
  PlanningProduct,
} from "../types/planner.types";

export type PlannerAnnualChartMonth = {
  monthIndex: number;
  yearMonth: string;
  confirmedInboundUnits: number;
  confirmedInboundRetailValueEur: number;
  inboundValueIncomplete: boolean;
  replenishmentUnits: number;
  replenishmentCostEur: number;
  newProductInvestmentBudgetEur: number;
  inboundItems: Array<{
    productId: string;
    sku: string;
    productName: string;
    units: number;
    retailValueEur: number | null;
    eta: string;
    orderId: string | null;
    orderNumber: string | null;
    country: string | null;
  }>;
  replenishmentItems: Array<{
    productId: string;
    sku: string;
    productName: string;
    units: number;
    orderDate: string;
    estimatedArrivalDate: string | null;
    destination: string;
    purchaseCostEur: number | null;
    logisticsCalendarRisk: boolean;
    warnings: string[];
  }>;
};

function monthIsoAtOffset(start: Date, offset: number): string {
  const date = new Date(start);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

export function buildPlannerAnnualChart(input: {
  products: PlanningProduct[];
  replenishmentLines: EnrichedAnnualPurchasePlanLine[];
  newProductBudgetEur: number;
  horizonMonths?: number;
  today?: Date;
}): { months: PlannerAnnualChartMonth[]; investmentQuarter: string | null } {
  const horizonMonths = input.horizonMonths ?? 12;
  const start = new Date(input.today ?? new Date());
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  const months: PlannerAnnualChartMonth[] = Array.from(
    { length: horizonMonths },
    (_, monthIndex) => ({
      monthIndex,
      yearMonth: monthIsoAtOffset(start, monthIndex),
      confirmedInboundUnits: 0,
      confirmedInboundRetailValueEur: 0,
      inboundValueIncomplete: false,
      replenishmentUnits: 0,
      replenishmentCostEur: 0,
      newProductInvestmentBudgetEur: 0,
      inboundItems: [],
      replenishmentItems: [],
    }),
  );
  const monthByIso = new Map(months.map((month) => [month.yearMonth, month]));

  for (const product of input.products) {
    for (const inbound of product.inboundSchedule ?? []) {
      if (inbound.confidence !== "confirmed" || inbound.usableForPlanning === false) continue;
      const month = monthByIso.get(inbound.eta.slice(0, 7));
      if (!month) continue;
      const salePrice = product.salePrice;
      const retailValue = salePrice != null ? inbound.units * salePrice : null;
      month.confirmedInboundUnits += inbound.units;
      if (retailValue == null) month.inboundValueIncomplete = true;
      else month.confirmedInboundRetailValueEur += retailValue;
      month.inboundItems.push({
        productId: product.id,
        sku: product.sku,
        productName: product.nombre ?? product.sku,
        units: inbound.units,
        retailValueEur: retailValue,
        eta: inbound.eta,
        orderId: inbound.ordenId ?? null,
        orderNumber: inbound.numeroOrden ?? null,
        country: inbound.forecastCountry,
      });
    }
  }

  for (const line of input.replenishmentLines) {
    if (!line.recommendedOrderDate) continue;
    const month = monthByIso.get(line.recommendedOrderDate.slice(0, 7));
    if (!month) continue;
    month.replenishmentUnits += line.recommendedOrderUnits;
    month.replenishmentCostEur += line.purchaseCapitalRequired ?? 0;
    const warnings = line.replenishmentWarnings ?? [];
    month.replenishmentItems.push({
      productId: line.productId,
      sku: line.sku,
      productName: line.productName ?? line.sku,
      units: line.recommendedOrderUnits,
      orderDate: line.recommendedOrderDate,
      estimatedArrivalDate: line.estimatedArrivalDate,
      destination: line.recommendedDestination,
      purchaseCostEur: line.purchaseCapitalRequired,
      logisticsCalendarRisk: warnings.some((warning) =>
        warning.toLowerCase().includes("calendario logístico"),
      ),
      warnings,
    });
  }

  const investmentMonths = months.filter((month) => {
    const calendarMonth = Number(month.yearMonth.slice(5, 7));
    return calendarMonth >= 1 && calendarMonth <= 3 && month.replenishmentUnits === 0;
  });
  const monthlyBudget =
    investmentMonths.length > 0
      ? Math.max(0, input.newProductBudgetEur) / investmentMonths.length
      : 0;
  for (const month of investmentMonths) {
    month.newProductInvestmentBudgetEur = monthlyBudget;
  }

  return {
    months,
    investmentQuarter:
      investmentMonths.length > 0 ? `${investmentMonths[0].yearMonth.slice(0, 4)}-T1` : null,
  };
}
