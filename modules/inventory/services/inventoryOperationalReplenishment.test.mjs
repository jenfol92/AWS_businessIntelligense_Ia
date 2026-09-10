import test from "node:test";
import assert from "node:assert/strict";
import { coverageDays, avgDaily } from "./inventoryMetrics.ts";
import { simulateDailyReplenishment } from "../../planner/services/simulateDailyReplenishment.ts";
import { resolveReplenishmentParams } from "../../planner/services/resolveReplenishmentParams.ts";
import { resolveLatestOrderDateForArrival } from "../../planner/services/resolveLatestOrderDateForArrival.ts";
import { buildInventoryEtaRisk } from "./buildInventoryEtaRisk.ts";

const confirmed = (eta, units) => ({ eta, units, confidence: "confirmed", planningKind: "PURCHASE_ORDER_CONFIRMED", usableForPlanning: true, forecastCountry: null, forecastChannel: "ALL" });
const provisional = (eta, units) => ({ eta, units, confidence: "provisional", planningKind: "PURCHASE_ORDER_PROVISIONAL", usableForPlanning: false, forecastCountry: null, forecastChannel: "ALL" });
const simulate = (inboundSchedule) => simulateDailyReplenishment({ startDate: "2026-09-01", horizonDays: 20, initialStock: 10, dailyDemand: { kind: "uniform", dailyDemand: 2 }, inboundSchedule, reorderPointUnits: 4, safetyStockUnits: 2, leadTimeDays: 5, targetCoverageDays: 30, monthlyPlanMonths: [] });

test("coverage uses operational stock and inclusive 30d demand without Infinity", () => {
  assert.equal(avgDaily(60, 30), 2);
  assert.equal(coverageDays(20, avgDaily(60, 30)), 10);
  assert.equal(coverageDays(20, 0), null);
});

test("A: sufficient confirmed inbound before the original stockout avoids an alert in the horizon", () => {
  const result = simulate([confirmed("2026-09-03", 40)]);
  assert.equal(result.estimatedStockoutDate, null);
  assert.equal(buildInventoryEtaRisk(result.estimatedStockoutDate, []).stockoutBeforeInbound, false);
});

test("B: insufficient confirmed inbound does not hide stockout", () => {
  const result = simulate([confirmed("2026-09-03", 1)]);
  assert.equal(result.estimatedStockoutDate, "2026-09-06");
});

test("C: two confirmed inbounds affect stockout chronologically by ETA and quantity", () => {
  const firstOnly = simulate([confirmed("2026-09-03", 1)]);
  const both = simulate([confirmed("2026-09-03", 1), confirmed("2026-09-05", 3)]);
  assert.equal(firstOnly.estimatedStockoutDate, "2026-09-06");
  assert.equal(both.estimatedStockoutDate, "2026-09-08");
});

test("D: a large provisional inbound does not affect confirmed operational stockout", () => {
  const withoutInbound = simulate([]);
  const withProvisional = simulate([provisional("2026-09-03", 100)]);
  assert.equal(withProvisional.estimatedStockoutDate, withoutInbound.estimatedStockoutDate);
  assert.equal(withProvisional.estimatedStockoutDate, "2026-09-06");
});

test("recommended order date subtracts reused lead-time components and supports ORDER_NOW", () => {
  const replenishment = resolveReplenishmentParams({ productId: "p", demand: { dailyDemand: 2, source: "sales_30d", warnings: [] }, supplyConfig: { leadTimeProduccionDias: 2, leadTimeTransporteDias: 3, leadTimeAduanaDias: 1 }, hasSupplyConfigRow: true });
  assert.equal(replenishment.leadTimeDays, 6);
  const timing = resolveLatestOrderDateForArrival({ requiredArrivalDate: "2026-09-10", productionDays: replenishment.productionDays, transitDays: replenishment.transitDays, customsDays: replenishment.customsDays, domesticDays: replenishment.domesticDays, calendarEvents: [] });
  assert.equal(timing.latestOrderDate, "2026-09-04");
  assert.equal(timing.latestOrderDate <= "2026-09-04", true);
});

test("E: ETA risk reports four days from simulated stockout to the next confirmed arrival", () => {
  const schedule = [confirmed("2026-09-03", 1), confirmed("2026-09-10", 20)];
  const simulation = simulate(schedule);
  assert.equal(simulation.estimatedStockoutDate, "2026-09-06");
  const risk = buildInventoryEtaRisk(simulation.estimatedStockoutDate, [
    { eta: "2026-09-04", cantidadPendiente: 100, planningKind: "PURCHASE_ORDER_PROVISIONAL", usableForPlanning: false },
    { eta: "2026-09-10", cantidadPendiente: 20, planningKind: "PURCHASE_ORDER_CONFIRMED", usableForPlanning: true },
  ]);
  assert.equal(risk.stockoutBeforeInbound, true);
  assert.equal(risk.stockoutDate, "2026-09-06");
  assert.equal(risk.nextRelevantConfirmedEta, "2026-09-10");
  assert.equal(risk.gapDays, 4);
});

test("F: an unknown non-provisional planning kind is not classified as confirmed", () => {
  const risk = buildInventoryEtaRisk("2026-09-05", [
    { eta: "2026-09-09", cantidadPendiente: 999, planningKind: "UNKNOWN_KIND", usableForPlanning: undefined, confidence: undefined },
  ]);
  assert.equal(risk.nextRelevantConfirmedEta, null);
  assert.equal(risk.gapDays, null);
});
