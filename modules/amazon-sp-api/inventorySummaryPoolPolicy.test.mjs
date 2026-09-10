import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_INVENTORY_MARKETPLACE_POOL_PLAN,
  OPERATIONAL_INVENTORY_POOLS,
  PAN_EU_REFERENCE_MARKETPLACE_ID,
  PUBLISHED_INVENTORY_MARKETPLACE_POOL_PLAN,
  UK_REFERENCE_MARKETPLACE_ID,
  inventorySummaryRequestCount,
  approvePanEuEquivalence,
  resolveOperationalInventoryMarketplaceIds,
  resolvePublishedInventoryMarketplaceIds,
} from "./inventorySummaryPoolPolicy.ts";

test("operational preview defaults exactly to PAN_EU/ES and UK/GB", () => {
  assert.equal(DEFAULT_INVENTORY_MARKETPLACE_POOL_PLAN.kind, "PAN_EU_PLUS_UK_PREVIEW");
  assert.equal(PAN_EU_REFERENCE_MARKETPLACE_ID, "A1RKKUPIHCS9HS");
  assert.equal(UK_REFERENCE_MARKETPLACE_ID, "A1F83G8C2ARO7P");
  assert.deepEqual(OPERATIONAL_INVENTORY_POOLS, [
    { operationalPool: "PAN_EU", observationMarketplaceId: "A1RKKUPIHCS9HS" },
    { operationalPool: "UK", observationMarketplaceId: "A1F83G8C2ARO7P" },
  ]);
  assert.deepEqual(resolveOperationalInventoryMarketplaceIds(), ["A1RKKUPIHCS9HS", "A1F83G8C2ARO7P"]);
  assert.deepEqual(resolveOperationalInventoryMarketplaceIds([]), ["A1RKKUPIHCS9HS", "A1F83G8C2ARO7P"]);
  assert.equal(inventorySummaryRequestCount(135), 6);
});

test("production publication requires atomic PAN_EU/ES plus UK/GB", () => {
  assert.equal(PUBLISHED_INVENTORY_MARKETPLACE_POOL_PLAN.kind, "PAN_EU_PLUS_GB");
  assert.deepEqual(resolvePublishedInventoryMarketplaceIds(), [
    "A1RKKUPIHCS9HS",
    "A1F83G8C2ARO7P",
  ]);
});

test("explicit multi-marketplace diagnostics remain available", () => {
  assert.deepEqual(
    resolveOperationalInventoryMarketplaceIds([
      "A1RKKUPIHCS9HS",
      "A13V1IB3VIYZZH",
      "A1PA6795UKMFR9",
      "A1RKKUPIHCS9HS",
    ]),
    ["A1RKKUPIHCS9HS", "A13V1IB3VIYZZH", "A1PA6795UKMFR9"],
  );
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
