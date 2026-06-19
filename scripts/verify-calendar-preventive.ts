/**
 * Validación detalle mensual agosto (ALAIA) + ciclo preventivo CNY
 * npx tsx scripts/verify-calendar-preventive.ts
 */
import { buildPurchaseCycles } from "../modules/planner/services/buildPurchaseCycles";
import { resolveReplenishmentParams } from "../modules/planner/services/resolveReplenishmentParams";
import {
  simulateDailyReplenishment,
  calendarDaysDifferenceUtc,
} from "../modules/planner/services/simulateDailyReplenishment";
import type { ForecastInboundScheduleEntry } from "../modules/planner/types/forecastInbound.types";
import type { LogisticsCalendarEventInput } from "../modules/planner/services/resolveLogisticsCalendarImpact";

const SIM_DATE = "2026-06-16";
const DAILY_DEMAND = 4.57;
const INBOUND_ETA = "2026-08-08";
const INBOUND_UNITS = 1640;

const ALAIA_INBOUND: ForecastInboundScheduleEntry[] = [
  {
    eta: INBOUND_ETA,
    units: INBOUND_UNITS,
    confidence: "provisional",
    planningKind: "PURCHASE_ORDER_CONFIRMED",
    usableForPlanning: true,
    forecastCountry: null,
    forecastChannel: "ALL",
  },
];

const CNY_2027: LogisticsCalendarEventInput = {
  name: "Año Nuevo Chino 2027",
  type: "chinese_new_year",
  startDate: "2027-01-25",
  endDate: "2027-02-10",
  impactDays: 21,
  affectsProduction: true,
  affectsTransport: true,
  country: "CN",
};

function fmt(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("es-ES", { maximumFractionDigits: 0 });
}

function assertCoverageCoherence(
  c: import("../modules/planner/types/replenishment.types").PurchaseCycle,
): void {
  const eta = c.estimatedArrivalDate.slice(0, 10);
  const effectiveFrom = (c.effectiveCoverageFrom ?? c.coversFrom).slice(0, 10);
  const effectiveTo = (c.effectiveCoverageTo ?? c.coversTo).slice(0, 10);

  if (effectiveFrom < eta) {
    throw new Error(
      `Incoherencia: effectiveCoverageFrom (${effectiveFrom}) < ETA (${eta})`,
    );
  }
  if (effectiveTo < effectiveFrom) {
    throw new Error(
      `Incoherencia: effectiveCoverageTo (${effectiveTo}) < effectiveCoverageFrom (${effectiveFrom})`,
    );
  }

  const demandFrom = c.demandWindowFrom?.slice(0, 10);
  if (demandFrom && demandFrom < eta) {
    if (c.stockCoverageBeforeArrival == null) {
      throw new Error(
        "Falta stockCoverageBeforeArrival cuando demandWindowFrom < ETA",
      );
    }
    if (c.estimatedLostSalesBeforeArrival == null) {
      throw new Error(
        "Falta estimatedLostSalesBeforeArrival cuando demandWindowFrom < ETA",
      );
    }
  }
}

function main() {
  const replenishment = resolveReplenishmentParams({
    productId: "test",
    demand: {
      dailyDemand: DAILY_DEMAND,
      monthlyDemand: DAILY_DEMAND * 30,
      source: "ANNUAL_AVERAGE",
      basis: "test",
      warnings: [],
    },
    calendarEvents: [],
  });

  const replenishmentFixed = {
    ...replenishment,
    dailyDemand: DAILY_DEMAND,
    productionDays: 30,
    transitDays: 45,
    customsDays: 7,
    safetyBufferDays: 15,
    leadTimeDays: 82,
    leadTimeDemandUnits: Math.ceil(DAILY_DEMAND * 82),
    safetyStockUnits: Math.ceil(DAILY_DEMAND * 15),
    reorderPointUnits: Math.ceil(DAILY_DEMAND * 97),
    targetCoverageDays: 90,
  };

  const dailyDemandMode = {
    kind: "uniform" as const,
    dailyDemand: DAILY_DEMAND,
  };

  const augustSim = simulateDailyReplenishment({
    startDate: SIM_DATE,
    horizonDays: calendarDaysDifferenceUtc(SIM_DATE, "2026-08-31") + 1,
    initialStock: 0,
    dailyDemand: dailyDemandMode,
    inboundSchedule: ALAIA_INBOUND,
    reorderPointUnits: replenishmentFixed.reorderPointUnits,
    safetyStockUnits: replenishmentFixed.safetyStockUnits,
    leadTimeDays: replenishmentFixed.leadTimeDays,
    targetCoverageDays: replenishmentFixed.targetCoverageDays,
    replenishment: replenishmentFixed,
    monthlyPlanMonths: [8],
  });

  const august = augustSim.monthlyPlan[0];
  console.log("=== ALAIA — agosto 2026 ===");
  console.log(`Entrada prevista: ${fmt(august?.inboundConfirmed)} uds el ${INBOUND_ETA}`);
  console.log(`Pérdidas antes de entrada: ${fmt(august?.lostSalesBeforeFirstInbound)} uds`);
  console.log(`Ventas servidas tras entrada: ${fmt(august?.servedAfterInbound)} uds`);
  console.log(`Cierre agosto: ${fmt(august?.closingPhysicalStock)} uds`);

  const winterMonthly = Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    if (month >= 11 || month <= 3) return 400;
    return 150;
  });

  const cnyPlan = buildPurchaseCycles({
    initialStock: 200,
    dailyDemand: {
      kind: "calendar_year",
      monthlyForecast: winterMonthly,
      forecastYear: 2026,
    },
    inboundSchedule: [],
    replenishment: replenishmentFixed,
    productionDays: 30,
    transitDays: 45,
    customsDays: 7,
    calendarEvents: [CNY_2027],
    unitCostEur: 12.5,
    startDate: SIM_DATE,
    horizonDays: 365,
  });

  console.log("\n=== Producto con demanda dic–mar — CNY 2027 ===");
  const preventive = cnyPlan.cycles.filter((c) => c.reason === "CALENDAR_PREVENTIVE");
  console.log(`Ciclos preventivos: ${preventive.length}`);
  for (const c of preventive) {
    assertCoverageCoherence(c);
    console.log(`\nPedido preventivo — ${c.calendarEvents[0]?.name ?? "evento"}`);
    console.log(`Pedir antes de: ${c.latestOrderDate}`);
    console.log(`Llegada estimada: ${c.estimatedArrivalDate}`);
    console.log(
      `Periodo protegido (demanda): ${c.demandWindowFrom} → ${c.demandWindowTo}`,
    );
    console.log(
      `Este pedido cubre desde: ${c.effectiveCoverageFrom} (>= ETA)`,
    );
    console.log(`Cubre hasta: ${c.effectiveCoverageTo}`);
    console.log(
      `Stock previo cubre antes de llegada: ${c.stockCoverageBeforeArrival ? "sí" : "no"}${
        c.stockCoveredUntilBeforeArrival
          ? ` · hasta ${c.stockCoveredUntilBeforeArrival}`
          : ""
      }`,
    );
    console.log(
      `Ventas perdidas antes de llegada: ${fmt(c.estimatedLostSalesBeforeArrival)} uds`,
    );
    console.log(`Unidades: ${fmt(c.units)}`);
    console.log(`Motivo: ${c.businessMessage}`);
  }

  const monthlyInBlock = cnyPlan.cycles.filter(
    (c) =>
      c.reason !== "CALENDAR_PREVENTIVE" &&
      c.orderDate >= "2026-12-01" &&
      c.orderDate <= "2027-02-28",
  );
  console.log(`\nPedidos sueltos en ventana CNY (debería ser 0): ${monthlyInBlock.length}`);

  if ((august?.lostSalesBeforeFirstInbound ?? 0) <= 0) {
    console.error("FALLO: agosto debería tener pérdidas antes de entrada.");
    process.exit(1);
  }
  if (preventive.length === 0) {
    console.error("FALLO: debería generar ciclo CALENDAR_PREVENTIVE para CNY.");
    process.exit(1);
  }
  console.log("\nOK — cobertura coherente con ETA");
}

main();
