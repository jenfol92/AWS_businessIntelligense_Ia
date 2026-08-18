import test from "node:test";
import assert from "node:assert/strict";
import { assertInventorySummaryPageBudget, assertInventorySummaryRequestBudget, assertInventorySummaryRuntimeBudget, inventorySummaryMaxPagesPerBatch, inventorySummaryRequestBudget } from "./inventorySummaryRequestPolicy.ts";

test("request budget scales with configured marketplaces and page ceiling", () => {
  assert.equal(inventorySummaryRequestBudget(7, 25), 175);
  assert.equal(inventorySummaryRequestBudget(1, 25), 25);
  assert.equal(inventorySummaryRequestBudget(7), 35);
});

test("page budget is configurable and fail-closed", () => {
  assert.equal(inventorySummaryMaxPagesPerBatch("9"), 9);
  assert.doesNotThrow(() => assertInventorySummaryPageBudget({ pageNumber: 5, maxPagesPerBatch: 5 }));
  assert.throws(() => assertInventorySummaryPageBudget({ pageNumber: 6, maxPagesPerBatch: 5 }), /page budget exceeded/);
});

test("runtime budget is fail-closed", () => {
  assert.throws(() => assertInventorySummaryRuntimeBudget({ startedAtMs: 0, nowMs: 10, maxRuntimeMs: 10 }), /runtime budget exceeded/);
});

test("pagination stops before exceeding its per-sync request budget", () => {
  assert.doesNotThrow(() => assertInventorySummaryRequestBudget({ amazonHttpCalls: 34, requestBudget: 35 }));
  assert.throws(() => assertInventorySummaryRequestBudget({ amazonHttpCalls: 35, requestBudget: 35 }), /budget exceeded/);
});
