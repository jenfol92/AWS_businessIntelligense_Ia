import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerAnnualChart } from "./buildPlannerAnnualChart.ts";

test("incluye inbound confirmado de productos aunque no tengan reposición", () => {
  const chart = buildPlannerAnnualChart({
    today: new Date("2026-09-03T00:00:00Z"),
    newProductBudgetEur: 900,
    products: [{
      id: "p1", sku: "SKU-1", nombre: "Producto 1", salePrice: 25,
      inboundSchedule: [{ eta: "2026-10-15", units: 100, confidence: "confirmed", usableForPlanning: true, ordenId: "o1", numeroOrden: "OC-1", forecastCountry: "FR", forecastChannel: "AMAZON_FBA" }],
    }],
    replenishmentLines: [],
  });
  const october = chart.months.find((month) => month.yearMonth === "2026-10");
  assert.equal(october?.confirmedInboundUnits, 100);
  assert.equal(october?.confirmedInboundRetailValueEur, 2500);
  assert.equal(october?.inboundItems[0]?.orderNumber, "OC-1");
});

test("excluye inbound provisional y reserva inversión sólo en T1 sin reposición", () => {
  const chart = buildPlannerAnnualChart({
    today: new Date("2026-09-03T00:00:00Z"),
    newProductBudgetEur: 900,
    products: [{
      id: "p1", sku: "SKU-1", nombre: "Producto 1", salePrice: 25,
      inboundSchedule: [{ eta: "2027-01-15", units: 100, confidence: "provisional", usableForPlanning: false, forecastCountry: "ES", forecastChannel: "AMAZON_FBA" }],
    }],
    replenishmentLines: [{ productId: "p1", sku: "SKU-1", productName: "Producto 1", recommendedOrderDate: "2027-01-05", recommendedOrderUnits: 200, purchaseCapitalRequired: 1000, estimatedArrivalDate: "2027-04-01", recommendedDestination: "FR", replenishmentWarnings: [] }],
  });
  const january = chart.months.find((month) => month.yearMonth === "2027-01");
  const february = chart.months.find((month) => month.yearMonth === "2027-02");
  const march = chart.months.find((month) => month.yearMonth === "2027-03");
  assert.equal(january?.confirmedInboundUnits, 0);
  assert.equal(january?.newProductInvestmentBudgetEur, 0);
  assert.equal(february?.newProductInvestmentBudgetEur, 450);
  assert.equal(march?.newProductInvestmentBudgetEur, 450);
});
