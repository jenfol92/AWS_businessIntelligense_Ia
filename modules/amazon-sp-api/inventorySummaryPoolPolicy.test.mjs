import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INVENTORY_MARKETPLACE_POOL_PLAN,
  inventorySummaryRequestCount,
  approvePanEuEquivalence,
} from "./inventorySummaryPoolPolicy.ts";

test("default keeps six continental marketplaces plus GB", () => {
  assert.equal(DEFAULT_INVENTORY_MARKETPLACE_POOL_PLAN.kind, "MARKETPLACE_INDEPENDENT");
  assert.equal(DEFAULT_INVENTORY_MARKETPLACE_POOL_PLAN.marketplaceIds.length, 7);
  assert.equal(inventorySummaryRequestCount(135), 21);
});

test("Pan-EU reduction requires explicit ES-DE evidence", () => {
  assert.throws(() => approvePanEuEquivalence({
    evidenceId: "",
    representativeMarketplaceId: "A1RKKUPIHCS9HS",
    comparisonMarketplaceId: "A1PA6795UKMFR9",
    exactSellerSkuSet: ["SKU"],
    equalOperationalSignatures: true,
    noUnexpectedPagination: true,
  }), /PAN_EU_EVIDENCE_ID_REQUIRED/);
  const plan = approvePanEuEquivalence({
    evidenceId: "es-de-2026-08-18",
    representativeMarketplaceId: "A1RKKUPIHCS9HS",
    comparisonMarketplaceId: "A1PA6795UKMFR9",
    exactSellerSkuSet: ["SKU"],
    equalOperationalSignatures: true,
    noUnexpectedPagination: true,
  });
  assert.equal(plan.kind, "PAN_EU_PLUS_GB");
  assert.equal(inventorySummaryRequestCount(135, plan), 6);
});
