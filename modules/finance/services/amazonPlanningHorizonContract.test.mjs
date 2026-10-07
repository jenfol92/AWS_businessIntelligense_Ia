import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAmazonPlanningHorizonMonths } from "../utils/amazonPlanningHorizon.ts";
import { aggregateDeferredByReleaseMonth } from "./amazonDeferredReleaseAggregates.ts";

const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

function buildLayerMonthKeys(deferredMonthly, pendingBankMonthly, futureMonthly) {
  return {
    deferred: deferredMonthly.map((row) => row.month),
    pendingBank: pendingBankMonthly.map((row) => row.month),
    future: futureMonthly.map((row) => row.month),
  };
}

test("three Amazon layer monthly series share the same 12 months in order", () => {
  const horizon = buildAmazonPlanningHorizonMonths("2026-09");
  const deferredMonthly = aggregateDeferredByReleaseMonth(
    [{ amazon_release_date: "2026-10-05", amount_eur: 10, original_amount: 10, original_currency: "EUR" }],
    horizon,
  ).filter((bucket) => bucket.month && horizon.includes(bucket.month));
  const pendingBankMonthly = horizon.map((month) => ({ month, knownEur: month === "2026-11" ? 50 : null }));
  const futureMonthly = horizon.map((month) => ({ month, estimatedEur: month === "2026-12" ? 100 : null }));
  const keys = buildLayerMonthKeys(deferredMonthly, pendingBankMonthly, futureMonthly);
  assert.deepEqual(keys.pendingBank, horizon);
  assert.deepEqual(keys.future, horizon);
  assert.deepEqual(keys.deferred, horizon);
});

test("buildFinancialPlanning exposes amazonPlanningHorizonMonths and uses it for all layer monthly arrays", async () => {
  const planning = await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.match(planning, /amazonPlanningHorizonMonths=buildAmazonPlanningHorizonMonths\(fromMonth\)/);
  assert.match(planning, /amazonPlanningHorizonMonths,/);
  assert.match(planning, /pendingBankByMonth=amazonPlanningHorizonMonths\.map/);
  assert.match(planning, /futureForecastByMonth=amazonPlanningHorizonMonths\.map/);
  assert.match(planning, /deferredReleaseMonthlyByHorizon=amazonPlanningHorizonMonths\.map/);
  assert.doesNotMatch(planning, /futureForecastByMonth=monthKeys\.map/);
});

test("query.months does not shrink Amazon annual horizon in builder", async () => {
  const planning = await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.match(planning, /buildAmazonPlanningHorizonMonths\(fromMonth\)/);
  assert.doesNotMatch(planning, /pendingBankByMonth=monthKeys\.map/);
});

test("repository loads FUTURE forecasts for 12 months without widening other planning queries", async () => {
  const repo = await read("modules/finance/repositories/financialPlanningRepository.ts");
  assert.match(repo, /amazonForecastToDate = lastDayOfWindow\(fromMonth, AMAZON_PLANNING_HORIZON_MONTH_COUNT\)/);
  assert.match(repo, /\.lte\("forecast_date", amazonForecastToDate\)/);
  assert.match(repo, /readRecurringCalendar\(supabase, fromDate, toDate\)/);
  assert.doesNotMatch(repo, /readRecurringCalendar\(supabase, fromDate, amazonForecastToDate\)/);
});

test("amazonDeferredEur keeps legacy event-bucket semantics; release uses amazonDeferredReleaseKnownEur", async () => {
  const planning = await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.match(
    planning,
    /amazonDeferredEur:datedEvents\.filter\(event=>!event\.isInformational&&event\.type==="amazon_income"&&event\.amazonStatus==="DEFERRED"\)/,
  );
  assert.match(planning, /amazonDeferredReleaseKnownEur:deferredReleaseKnownByMonth\.get\(month\)/);
  assert.doesNotMatch(planning, /amazonDeferredEur:deferredReleaseKnownByMonth/);
  const types = await read("modules/finance/types/planning.types.ts");
  assert.match(types, /Do not use for Amazon release-by-month; prefer amazonDeferredReleaseKnownEur/);
});

test("amazonDeferredReleaseKnownEur remains Amazon release semantics and NULL incompleteness is preserved", () => {
  const horizon = buildAmazonPlanningHorizonMonths("2026-09");
  const monthly = aggregateDeferredByReleaseMonth(
    [
      {
        amazon_release_date: "2026-09-24",
        amount_eur: null,
        original_amount: 100,
        original_currency: "AED",
      },
      {
        amazon_release_date: "2026-09-24",
        amount_eur: 10,
        original_amount: 10,
        original_currency: "EUR",
      },
    ],
    horizon,
  );
  const bucket = monthly.find((row) => row.month === "2026-09");
  assert.equal(bucket.knownEur, 10);
  assert.equal(bucket.unvaluedCount, 1);
  assert.equal(bucket.isComplete, false);
  assert.deepEqual(bucket.unvaluedOriginalByCurrency, { AED: 100 });
});

test("FUTURE months 7-12 are sourced from extended forecast rows via datedPlanningEvents", async () => {
  const planning = await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.match(
    planning,
    /futureForecastByMonth=amazonPlanningHorizonMonths\.map\(month=>\(\{[\s\S]*datedPlanningEvents\.filter\(event=>event\.type==="amazon_income"&&event\.amazonStatus==="FUTURE"/,
  );
});
