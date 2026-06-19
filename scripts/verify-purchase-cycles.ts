/**
 * Validación — ciclos de compra con inbound confirmado (ALAIA)
 * npx tsx scripts/verify-purchase-cycles.ts
 */
import { buildPurchaseCycles } from "../modules/planner/services/buildPurchaseCycles";
import { resolveReplenishmentParams } from "../modules/planner/services/resolveReplenishmentParams";
import { resolveReplenishmentDemand } from "../modules/planner/services/resolveReplenishmentDemand";
import {
  simulateDailyReplenishment,
  calendarDaysDifferenceUtc,
} from "../modules/planner/services/simulateDailyReplenishment";
import { inboundPlanningKindLabel } from "../modules/planner/services/resolveInboundPlanningKind";
import type { ForecastInboundScheduleEntry } from "../modules/planner/types/forecastInbound.types";

const SIM_DATE = "2026-06-16";
const STOCK = 0;
const DAILY_DEMAND = 4.57;
const INBOUND_ETA = "2026-08-08";
const INBOUND_UNITS = 1640;
const PRODUCTION = 30;
const TRANSIT = 45;
const CUSTOMS = 7;
const BUFFER = 15;
const UNIT_COST = 12.5;

/** Simula las 4 órdenes confirmadas sin contenedor (confidence legacy = provisional). */
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

function fmt(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("es-ES", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function main() {
  const demand = resolveReplenishmentDemand({
    annualForecastMonthly: Array.from({ length: 12 }, () =>
      Math.round(DAILY_DEMAND * 30),
    ),
    useStockoutCorrectedForecast: false,
    referenceDate: new Date(`${SIM_DATE}T12:00:00.000Z`),
  });

  let replenishment = resolveReplenishmentParams({
    productId: "test-alaia",
    demand: { ...demand, dailyDemand: DAILY_DEMAND },
    calendarEvents: [],
  });

  replenishment = {
    ...replenishment,
    dailyDemand: DAILY_DEMAND,
    productionDays: PRODUCTION,
    transitDays: TRANSIT,
    customsDays: CUSTOMS,
    safetyBufferDays: BUFFER,
    leadTimeDays: PRODUCTION + TRANSIT + CUSTOMS,
    leadTimeDemandUnits: Math.ceil(DAILY_DEMAND * (PRODUCTION + TRANSIT + CUSTOMS)),
    safetyStockUnits: Math.ceil(DAILY_DEMAND * BUFFER),
    reorderPointUnits: Math.ceil(
      DAILY_DEMAND * (PRODUCTION + TRANSIT + CUSTOMS + BUFFER),
    ),
    targetCoverageDays: 90,
  };

  const dailyDemandMode = {
    kind: "uniform" as const,
    dailyDemand: DAILY_DEMAND,
  };

  const preInboundSim = simulateDailyReplenishment({
    startDate: SIM_DATE,
    horizonDays: Math.max(calendarDaysDifferenceUtc(SIM_DATE, INBOUND_ETA), 1),
    initialStock: STOCK,
    dailyDemand: dailyDemandMode,
    inboundSchedule: ALAIA_INBOUND,
    reorderPointUnits: replenishment.reorderPointUnits,
    safetyStockUnits: replenishment.safetyStockUnits,
    leadTimeDays: replenishment.leadTimeDays,
    targetCoverageDays: replenishment.targetCoverageDays,
    replenishment,
    monthlyPlanMonths: [],
  });

  const plan = buildPurchaseCycles({
    initialStock: STOCK,
    dailyDemand: dailyDemandMode,
    inboundSchedule: ALAIA_INBOUND,
    replenishment,
    productionDays: PRODUCTION,
    transitDays: TRANSIT,
    customsDays: CUSTOMS,
    calendarEvents: [],
    unitCostEur: UNIT_COST,
    startDate: SIM_DATE,
    horizonDays: 365,
  });

  console.log("=== Verificación ALAIA — inbound confirmado sin contenedor ===\n");
  console.log(`Stock inicial: ${STOCK} uds`);
  console.log(`Demanda diaria: ${DAILY_DEMAND} uds/día`);
  console.log(`Fecha simulación: ${SIM_DATE}\n`);

  console.log("Inbound usado para planificación:");
  if (plan.planningInbound.used.length === 0) {
    console.log("  (ninguno)");
  } else {
    for (const entry of plan.planningInbound.used) {
      console.log(
        `  ${entry.eta.slice(0, 10)} — ${fmt(entry.units)} uds — ${entry.planningKind ?? "?"}`,
      );
    }
  }

  console.log("\nInbound ignorado y motivo:");
  if (plan.planningInbound.ignored.length === 0) {
    console.log("  (ninguno)");
  } else {
    for (const entry of plan.planningInbound.ignored) {
      console.log(
        `  ${entry.eta.slice(0, 10)} — ${fmt(entry.units)} uds — ${entry.planningKind ? inboundPlanningKindLabel(entry.planningKind) : "sin clasificar"}`,
      );
    }
  }

  console.log(`\nRotura antes de inbound (${INBOUND_ETA}): ${preInboundSim.estimatedStockoutDate != null ? "sí" : "no"}`);
  console.log(
    `Ventas perdidas antes de inbound: ${fmt(preInboundSim.estimatedLostSalesUnits)} uds`,
  );
  console.log(
    `  (esperado ≈ ${fmt(Math.round(calendarDaysDifferenceUtc(SIM_DATE, INBOUND_ETA) * DAILY_DEMAND))} uds)`,
  );

  console.log(`\nCiclos nuevos recomendados: ${plan.cycles.length}`);
  for (const c of plan.cycles) {
    console.log(`\n--- Pedido ${c.cycleNumber} (${c.status}) ---`);
    console.log(`Pedir: ${c.orderDate}`);
    console.log(`ETA: ${c.estimatedArrivalDate}`);
    console.log(`Unidades: ${fmt(c.units)}`);
    console.log(`Capital: ${c.capitalRequired != null ? `${fmt(c.capitalRequired, 2)} €` : "—"}`);
    console.log(`Ventas perdidas antes llegada: ${fmt(c.estimatedLostSalesBeforeArrival)}`);
  }

  console.log(`\nCapital ya comprometido: ${plan.capitalAlreadyCommitted != null ? `${fmt(plan.capitalAlreadyCommitted, 2)} €` : "no calculado por falta de coste"}`);
  console.log(`Capital adicional: ${fmt(plan.additionalCapitalRequired, 2)} €`);
  console.log(`Exposición total: ${plan.totalCapitalExposure != null ? `${fmt(plan.totalCapitalExposure, 2)} €` : "—"}`);

  const badFirstCycle = plan.cycles.find(
    (c) =>
      c.cycleNumber === 1 &&
      c.units >= 800 &&
      c.estimatedArrivalDate.slice(0, 10) <= "2026-09-15",
  );
  if (badFirstCycle) {
    console.error(
      `\nFALLO: se recomienda pedido duplicado (${badFirstCycle.units} uds, ETA ${badFirstCycle.estimatedArrivalDate}) pese al inbound del ${INBOUND_ETA}.`,
    );
    process.exit(1);
  }

  if (preInboundSim.estimatedLostSalesUnits < 200 || preInboundSim.estimatedLostSalesUnits > 280) {
    console.warn(
      `\nAVISO: ventas perdidas (${preInboundSim.estimatedLostSalesUnits}) fuera del rango esperado ~242 uds.`,
    );
  }

  console.log("\nOK: inbound confirmado contabilizado; no hay duplicación de pedido inmediato.");
}

main();
