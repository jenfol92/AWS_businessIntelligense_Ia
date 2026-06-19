/**
 * Validación Fase 2 — caso ALAIA - GRIS (8436616610104)
 * Ejecutar: npx tsx scripts/verify-replenishment-timing.ts
 */
import { resolveReplenishmentTiming } from "../modules/planner/services/resolveReplenishmentTiming";
import { resolveReplenishmentParams } from "../modules/planner/services/resolveReplenishmentParams";
import { resolveReplenishmentDemand } from "../modules/planner/services/resolveReplenishmentDemand";
import { utcTodayIso } from "../modules/planner/services/simulateDailyReplenishment";

const STOCK = 40;
const JUNE_FORECAST = 274;
const PRODUCTION = 30;
const TRANSIT = 45;
const CUSTOMS = 7;
const BUFFER = 15;
const SIM_DATE = "2026-06-16";

function main() {
  const demand = resolveReplenishmentDemand({
    annualForecastMonthly: Array.from({ length: 12 }, (_, i) =>
      i === 5 ? JUNE_FORECAST : 200,
    ),
    useStockoutCorrectedForecast: true,
    referenceDate: new Date(`${SIM_DATE}T12:00:00.000Z`),
  });

  const replenishment = resolveReplenishmentParams({
    productId: "test-alaia",
    demand,
    calendarEvents: [],
  });

  replenishment.productionDays = PRODUCTION;
  replenishment.transitDays = TRANSIT;
  replenishment.customsDays = CUSTOMS;
  replenishment.safetyBufferDays = BUFFER;
  replenishment.leadTimeDays = PRODUCTION + TRANSIT + CUSTOMS;
  replenishment.leadTimeDemandUnits = Math.ceil(
    demand.dailyDemand * replenishment.leadTimeDays,
  );
  replenishment.safetyStockUnits = Math.ceil(demand.dailyDemand * BUFFER);
  replenishment.reorderPointUnits = Math.ceil(
    demand.dailyDemand * (replenishment.leadTimeDays + BUFFER),
  );

  const timing = resolveReplenishmentTiming({
    openingStock: STOCK,
    replenishment,
    dailyDemandMode: {
      kind: "calendar_year",
      monthlyForecast: Array.from({ length: 12 }, (_, i) =>
        i === 5 ? JUNE_FORECAST : 200,
      ),
      forecastYear: 2026,
    },
    calendarEvents: [],
    horizonDays: 365,
    orderDate: SIM_DATE,
  });

  console.log("=== ALAIA - GRIS (simulado) ===");
  console.log(`Demanda diaria junio: ${demand.dailyDemand.toFixed(2)} uds/día`);
  console.log(`Cobertura: ${(STOCK / demand.dailyDemand).toFixed(2)} días`);
  console.log(`Punto de pedido: ${replenishment.reorderPointUnits} uds`);
  console.log(`Rotura prevista: ${timing.projectedStockoutDate}`);
  console.log(`Fecha objetivo llegada: ${timing.requiredArrivalDate}`);
  console.log(`Fecha límite segura: ${timing.latestSafeOrderDate}`);
  console.log(`Vencida: ${timing.isOrderAlreadyLate}`);
  console.log(`ETA si pido hoy (${SIM_DATE}): ${timing.orderTodayEta}`);
  console.log(
    `Ventas perdidas antes de llegada: ${timing.orderTodayLostSalesBeforeArrival} uds`,
  );
  console.log(`Estado: ${timing.replenishmentStatus}`);
  console.log(`Hoy real: ${utcTodayIso()}`);
}

main();
