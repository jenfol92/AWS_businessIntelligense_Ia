import test from "node:test";
import assert from "node:assert/strict";
import {
  AMAZON_PLANNING_HORIZON_MONTH_COUNT,
  buildAmazonPlanningHorizonMonths,
} from "./amazonPlanningHorizon.ts";

test("buildAmazonPlanningHorizonMonths returns exactly 12 consecutive YYYY-MM buckets", () => {
  const months = buildAmazonPlanningHorizonMonths("2026-09");
  assert.equal(months.length, AMAZON_PLANNING_HORIZON_MONTH_COUNT);
  assert.deepEqual(months, [
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
  ]);
});

test("horizon length is independent of caller query.months intent", () => {
  assert.equal(buildAmazonPlanningHorizonMonths("2026-01").length, 12);
  assert.equal(buildAmazonPlanningHorizonMonths("2026-01")[11], "2026-12");
});
