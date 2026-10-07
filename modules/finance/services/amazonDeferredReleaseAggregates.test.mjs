import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateDeferredByReleaseDate,
  aggregateDeferredByReleaseMonth,
  buildAmazonDeferredReleasePlanning,
  valuedEur,
} from "./amazonDeferredReleaseAggregates.ts";

const row = (patch = {}) => ({
  amazon_release_date: "2026-09-24",
  official_amount_eur: null,
  amount_eur: 10,
  original_amount: 10,
  original_currency: "EUR",
  ...patch,
});

test("daily grouping by amazon_release_date", () => {
  const daily = aggregateDeferredByReleaseDate([
    row({ amazon_release_date: "2026-09-24", amount_eur: 10 }),
    row({ amazon_release_date: "2026-09-24", amount_eur: -3 }),
    row({ amazon_release_date: "2026-09-17", amount_eur: 5 }),
  ]);
  assert.equal(daily.length, 2);
  const sep24 = daily.find((b) => b.date === "2026-09-24");
  assert.ok(sep24);
  assert.equal(sep24.transactionCount, 2);
  assert.equal(sep24.knownEur, 7);
  assert.equal(sep24.positiveKnownEur, 10);
  assert.equal(sep24.negativeKnownEur, -3);
});

test("monthly aggregation for horizon months", () => {
  const monthly = aggregateDeferredByReleaseMonth(
    [
      row({ amazon_release_date: "2026-09-24", amount_eur: 10 }),
      row({ amazon_release_date: "2026-10-01", amount_eur: 4 }),
    ],
    ["2026-09", "2026-10", "2026-11"],
  );
  assert.equal(monthly.find((m) => m.month === "2026-09")?.knownEur, 10);
  assert.equal(monthly.find((m) => m.month === "2026-10")?.knownEur, 4);
  assert.equal(monthly.find((m) => m.month === "2026-11")?.transactionCount, 0);
});

test("positive and negative known EUR stay separated in bucket totals", () => {
  const daily = aggregateDeferredByReleaseDate([
    row({ amount_eur: 20 }),
    row({ amount_eur: -5 }),
  ])[0];
  assert.equal(daily.positiveKnownEur, 20);
  assert.equal(daily.negativeKnownEur, -5);
  assert.equal(daily.knownEur, 15);
});

test("amount_eur NULL is not converted to zero", () => {
  assert.equal(valuedEur(row({ amount_eur: null, official_amount_eur: null, estimated_amount_eur: null })), null);
  const daily = aggregateDeferredByReleaseDate([
    row({ amount_eur: null, original_amount: 100, original_currency: "AED" }),
    row({ amount_eur: 10 }),
  ]);
  const bucket = daily.find((b) => b.date === "2026-09-24");
  assert.equal(bucket.unvaluedCount, 1);
  assert.deepEqual(bucket.unvaluedOriginalByCurrency, { AED: 100 });
  assert.equal(bucket.knownEur, 10);
  assert.equal(bucket.isComplete, false);
});

test("isComplete false when unvalued rows exist", () => {
  const bucket = aggregateDeferredByReleaseDate([
    row({ amount_eur: null, original_currency: "SAR", original_amount: 50 }),
  ])[0];
  assert.equal(bucket.isComplete, false);
});

test("isComplete true when all rows are valued", () => {
  const bucket = aggregateDeferredByReleaseDate([row({ amount_eur: 12 })])[0];
  assert.equal(bucket.isComplete, true);
});

test("buildAmazonDeferredReleasePlanning uses amazon_release_date semantics only", () => {
  const planning = buildAmazonDeferredReleasePlanning(
    [row({ expected_bank_date: "2099-01-01", amount_eur: 9 })],
    "2026-09-15T10:06:29.090Z",
    ["2026-09"],
  );
  assert.equal(planning.semantic, "amazon_release");
  assert.match(planning.label, /no ingreso bancario/i);
  assert.equal(planning.observedAt, "2026-09-15T10:06:29.090Z");
  assert.equal(planning.dailyByReleaseDate[0].date, "2026-09-24");
});
