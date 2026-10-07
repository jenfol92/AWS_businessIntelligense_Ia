import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregateDeferredByReleaseDate,
  buildAmazonDeferredReleasePlanning,
} from "./amazonDeferredReleaseAggregates.ts";

const read = (path) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

test("pendingDateEvents contract excludes individual DEFERRED treasury observations", async () => {
  const planning = await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.match(planning, /if\(state==="DEFERRED"\)continue/);
  assert.match(planning, /amazonDeferredRelease/);
  assert.match(planning, /deferredObservationRows=currentObservations\.filter\(row=>String\(row\["economic_state"\]\)==="DEFERRED"\)/);
});

test("DEFERRED aggregates never use expected_bank_date as release date", () => {
  const daily = aggregateDeferredByReleaseDate([
    {
      amazon_release_date: "2026-09-24",
      expected_bank_date: "2099-01-01",
      amount_eur: 10,
      original_amount: 10,
      original_currency: "EUR",
    },
  ]);
  assert.equal(daily[0].date, "2026-09-24");
});

test("AVAILABLE and PENDING_BANK remain in observation event loop", async () => {
  const planning = await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.match(planning, /if\(state==="DEFERRED"\)continue/);
  assert.match(planning, /amazonStatus:state/);
  assert.match(planning, /pendingBankByMonth/);
});

test("FUTURE remains on income forecast path", async () => {
  const planning = await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.match(planning, /toUpperCase\(\)==="FUTURE"/);
  assert.match(planning, /futureForecastByMonth/);
});

test("lazy detail endpoint exists for deferred release drill-down", async () => {
  const route = await read("app/api/finance/planning/amazon-deferred-release/route.ts");
  assert.match(route, /findDeferredAmazonReleaseDetail/);
  assert.match(route, /semantic: "amazon_release"/);
  assert.match(route, /releaseDate/);
  assert.match(route, /month/);
});

test("current-state observedAt is wired into deferred release planning", async () => {
  const repo = await read("modules/finance/repositories/financialPlanningRepository.ts");
  const planning = await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.match(repo, /amazonObservationObservedAt/);
  assert.match(planning, /raw\.amazonObservationObservedAt/);
  assert.match(planning, /amazonPlanningHorizonMonths/);
  const built = buildAmazonDeferredReleasePlanning([], "2026-09-15T10:06:29.090Z", ["2026-09"]);
  assert.equal(built.observedAt, "2026-09-15T10:06:29.090Z");
});
