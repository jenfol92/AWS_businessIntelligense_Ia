import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildAmazonAnnualChartRows,
  formatPlanningEur,
  unvaluedSummary,
} from "./amazonPlanningFormat.ts";

const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("formatPlanningEur preserves null as dash not zero", () => {
  assert.equal(formatPlanningEur(null), "—");
  assert.equal(formatPlanningEur(undefined), "—");
  assert.notEqual(formatPlanningEur(null), formatPlanningEur(0));
});

test("buildAmazonAnnualChartRows keeps DEFERRED, PENDING and FUTURE as independent fields", () => {
  const rows = buildAmazonAnnualChartRows(
    ["2026-09"],
    [{
      month: "2026-09",
      knownEur: 10,
      transactionCount: 1,
      positiveKnownEur: 10,
      negativeKnownEur: null,
      unvaluedCount: 0,
      unvaluedOriginalByCurrency: {},
      isComplete: true,
      date: null,
    }],
    [{ month: "2026-09", knownEur: 5 }],
    [{ month: "2026-09", estimatedEur: 20 }],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deferredKnown, 10);
  assert.equal(rows[0].pendingKnown, 5);
  assert.equal(rows[0].futureEstimated, 20);
  assert.equal("amazonTotal" in rows[0], false);
  assert.equal("combinedKnown" in rows[0], false);
  assert.equal("totalIngresos" in rows[0], false);
});

test("buildAmazonAnnualChartRows matches layers by month, not array position", () => {
  const rows = buildAmazonAnnualChartRows(
    ["2026-09", "2026-10", "2026-11"],
    [{ month: "2026-11", knownEur: 10, transactionCount: 1, positiveKnownEur: 10, negativeKnownEur: null, unvaluedCount: 0, unvaluedOriginalByCurrency: {}, isComplete: true, date: null }],
    [{ month: "2026-09", knownEur: 5 }],
    [{ month: "2026-10", estimatedEur: 20 }],
  );
  assert.equal(rows[0].pendingKnown, 5);
  assert.equal(rows[0].deferredKnown, null);
  assert.equal(rows[0].futureEstimated, null);
  assert.equal(rows[1].futureEstimated, 20);
  assert.equal(rows[1].deferredKnown, null);
  assert.equal(rows[2].deferredKnown, 10);
  assert.equal(rows[2].pendingKnown, null);
});

test("buildAmazonAnnualChartRows renders absent month buckets as null, not zero", () => {
  const rows = buildAmazonAnnualChartRows(
    ["2026-12"],
    [],
    [],
    [],
  );
  assert.equal(rows[0].deferredKnown, null);
  assert.equal(rows[0].pendingKnown, null);
  assert.equal(rows[0].futureEstimated, null);
  assert.equal(rows[0].deferredBucket, null);
});

test("unvaluedSummary lists original currencies without EUR conversion", () => {
  const summary = unvaluedSummary({
    date: "2026-09-24",
    month: "2026-09",
    knownEur: 10,
    transactionCount: 2,
    positiveKnownEur: 10,
    negativeKnownEur: null,
    unvaluedCount: 1,
    unvaluedOriginalByCurrency: { SAR: 50 },
    isComplete: false,
  });
  assert.match(summary, /1 sin valorar/);
  assert.match(summary, /SAR/);
});

test("FinancialPlanningPage uses release contract and not legacy amazonDeferredEur label", async () => {
  const page = await read("modules/finance/components/FinancialPlanningPage.tsx");
  assert.match(page, /AmazonAnnualPlanningSection/);
  assert.match(page, /amazonDeferredReleaseKnownEur/);
  assert.match(page, /Liberación Amazon \(mes\)/);
  assert.doesNotMatch(page, /Amazon diferido:/);
});

test("annual section table iterates chartRows from horizon, not deferredMonthly by index", async () => {
  const section = await read("modules/finance/components/AmazonAnnualPlanningSection.tsx");
  assert.match(section, /chartRows\.map/);
  assert.match(section, /amazonPlanningHorizonMonths/);
  assert.doesNotMatch(section, /pendingBankByMonth\.monthly\[index\]/);
  assert.doesNotMatch(section, /futureForecastByMonth\.monthly\[index\]/);
  assert.doesNotMatch(section, /deferredMonthly\.map/);
});

test("annual section uses recharts without summing layers", async () => {
  const section = await read("modules/finance/components/AmazonAnnualPlanningSection.tsx");
  assert.match(section, /from \"recharts\"/);
  assert.match(section, /Capas separadas/);
});
