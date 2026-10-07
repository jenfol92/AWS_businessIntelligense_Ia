import test from "node:test";
import assert from "node:assert/strict";
import { partitionFinanceEventsByDate } from "../utils/partitionFinanceEventsByDate.ts";
import { buildAmazonPlanningHorizonMonths, AMAZON_PLANNING_HORIZON_MONTH_COUNT } from "../utils/amazonPlanningHorizon.ts";
import {
  buildAmazonDeferredReleasePlanning,
} from "./amazonDeferredReleaseAggregates.ts";

function addMonths(fromMonth, offset) {
  const date = new Date(`${fromMonth}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function lastDayOfWindow(fromMonth, months) {
  const start = new Date(`${fromMonth}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + months);
  end.setUTCDate(0);
  return end.toISOString().slice(0, 10);
}

function asString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dateToMonth(date) {
  return date ? date.slice(0, 7) : null;
}

/** Mirrors buildFinancialPlanning FUTURE income -> event mapping. */
function buildFutureIncomeEvent(income) {
  const incomeStatus = String(income.status ?? "projected").toLowerCase();
  const storedState = String(income.economic_state ?? "").toUpperCase();
  const amazonStatus =
    incomeStatus === "received"
      ? "RECEIVED"
      : ["FUTURE", "DEFERRED", "AVAILABLE", "PENDING_BANK"].includes(storedState)
        ? storedState
        : "FUTURE";
  const expectedBankDate = asString(income.expected_bank_date);
  const date =
    amazonStatus === "RECEIVED"
      ? asString(income.received_at)?.slice(0, 10) ?? asString(income.forecast_date)
      : expectedBankDate;
  const amountEurRaw = income.treasury_amount_eur;
  const amountEur = amountEurRaw == null ? null : Number(amountEurRaw);
  const amount = amountEur ?? 0;
  const excludedState =
    amazonStatus === "RECEIVED" ||
    amazonStatus === "LEGACY_CONFIRMED" ||
    (amazonStatus === "DEFERRED" && !expectedBankDate) ||
    (amazonStatus === "AVAILABLE" && amount <= 0);
  const notConsolidable = amountEur == null && amazonStatus !== "RECEIVED";
  return {
    id: String(income.id),
    type: "amazon_income",
    date,
    month: dateToMonth(date),
    isPendingDate: !date,
    amazonStatus,
    isInformational: excludedState || notConsolidable,
    plannedAmountEur: amount,
  };
}

function repoWouldIncludeForecast(fromMonth, forecastDate) {
  const fromDate = `${fromMonth}-01`;
  const amazonForecastToDate = lastDayOfWindow(fromMonth, AMAZON_PLANNING_HORIZON_MONTH_COUNT);
  return forecastDate >= fromDate && forecastDate <= amazonForecastToDate;
}

const EXPECTED_HORIZON = [
  "2026-09",
  "2026-10",
  "2026-11",
  "2026-12",
  "2027-01",
  "2027-02",
  "2027-03",
  "2027-04",
  "2027-05",
  "2027-06",
  "2027-07",
  "2027-08",
];

test("repo amazon forecast window includes month 7-12 FUTURE rows when query.months=6", () => {
  const fromMonth = "2026-09";
  const queryMonths = 6;
  const planningToDate = lastDayOfWindow(fromMonth, queryMonths);
  const amazonForecastToDate = lastDayOfWindow(fromMonth, AMAZON_PLANNING_HORIZON_MONTH_COUNT);

  assert.equal(planningToDate, "2027-02-28");
  assert.equal(amazonForecastToDate, "2027-08-31");
  assert.equal(repoWouldIncludeForecast(fromMonth, "2027-04-01"), true);
  assert.equal(repoWouldIncludeForecast(fromMonth, "2027-08-15"), true);
  assert.equal(repoWouldIncludeForecast(fromMonth, "2027-04-01") && "2027-04-01" <= planningToDate, false);
});

test("functional: FUTURE loaded beyond query.months reaches futureForecastByMonth on months 7-12", () => {
  const fromMonth = "2026-09";
  const amazonPlanningHorizonMonths = buildAmazonPlanningHorizonMonths(fromMonth);
  assert.deepEqual(amazonPlanningHorizonMonths, EXPECTED_HORIZON);

  const rawForecasts = [
    {
      id: "f-apr",
      economic_state: "FUTURE",
      forecast_date: "2027-04-01",
      expected_bank_date: "2027-04-15",
      treasury_amount_eur: 500,
      status: "projected",
    },
    {
      id: "f-aug",
      economic_state: "FUTURE",
      forecast_date: "2027-08-01",
      expected_bank_date: "2027-08-20",
      treasury_amount_eur: 800,
      status: "projected",
    },
    {
      id: "f-feb",
      economic_state: "FUTURE",
      forecast_date: "2027-02-01",
      expected_bank_date: "2027-02-10",
      treasury_amount_eur: 100,
      status: "projected",
    },
  ];

  for (const row of rawForecasts) {
    assert.equal(repoWouldIncludeForecast(fromMonth, row.forecast_date), true);
  }

  const events = rawForecasts.map(buildFutureIncomeEvent);
  const { datedEvents: datedPlanningEvents } = partitionFinanceEventsByDate(events);

  const futureForecastByMonth = amazonPlanningHorizonMonths.map((month) => ({
    month,
    estimatedEur: (() => {
      const rows = datedPlanningEvents.filter(
        (event) =>
          event.type === "amazon_income" &&
          event.amazonStatus === "FUTURE" &&
          event.month === month &&
          !event.isInformational,
      );
      if (rows.length === 0) return null;
      return rows.reduce((sum, event) => sum + event.plannedAmountEur, 0);
    })(),
  }));

  assert.equal(futureForecastByMonth.find((row) => row.month === "2027-04")?.estimatedEur, 500);
  assert.equal(futureForecastByMonth.find((row) => row.month === "2027-08")?.estimatedEur, 800);
  assert.equal(futureForecastByMonth.find((row) => row.month === "2027-02")?.estimatedEur, 100);
  assert.equal(futureForecastByMonth.find((row) => row.month === "2026-09")?.estimatedEur, null);

  const amazonDeferredRelease = buildAmazonDeferredReleasePlanning(
    [{ amazon_release_date: "2027-04-10", amount_eur: 42, original_amount: 42, original_currency: "EUR" }],
    "2026-09-15T10:00:00Z",
    amazonPlanningHorizonMonths,
  );
  const deferredReleaseMonthlyByHorizon = amazonPlanningHorizonMonths.map(
    (month) =>
      amazonDeferredRelease.monthlyByReleaseMonth.find((bucket) => bucket.month === month) ?? {
        month,
        knownEur: null,
        transactionCount: 0,
      },
  );

  const pendingBankByMonth = amazonPlanningHorizonMonths.map((month) => ({
    month,
    knownEur: month === "2027-05" ? 120 : null,
    transactionCount: month === "2027-05" ? 1 : 0,
  }));

  for (const series of [deferredReleaseMonthlyByHorizon, pendingBankByMonth, futureForecastByMonth]) {
    assert.equal(series.length, 12);
    assert.deepEqual(
      series.map((row) => row.month),
      EXPECTED_HORIZON,
    );
  }

  assert.equal(deferredReleaseMonthlyByHorizon.find((row) => row.month === "2027-04")?.knownEur, 42);
});
