import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregatePhysicalInventoryByUniqueFnsku,
  fbaPoolForPhysicalCountry,
  normalizeAmazonPhysicalLocation,
  reconcileOperationalPoolWithPhysical,
} from "./amazonPhysicalInventoryReconciliation.ts";

const row = (overrides = {}) => ({
  asin: "B0DJBQGKBT",
  fnSku: "X00259GEWP",
  sellerSkuRepresentations: ["f8436616610104"],
  location: "DE",
  locationCountry: null,
  disposition: "SELLABLE",
  quantity: 84,
  snapshotAt: "2026-08-14T04:00:00Z",
  ...overrides,
});

test("FC is retained as FC and never treated as country", () => {
  assert.deepEqual(normalizeAmazonPhysicalLocation({ location: "MAD6", locationCountry: null }), {
    country: "UNKNOWN_LOCATION",
    fulfillmentCenter: "MAD6",
  });
  assert.deepEqual(normalizeAmazonPhysicalLocation({ location: "RLG1", locationCountry: "DE" }), {
    country: "DE",
    fulfillmentCenter: "RLG1",
  });
});

test("EU and UK physical countries remain separate pools", () => {
  assert.equal(fbaPoolForPhysicalCountry("ES"), "FBA_POOL_EU");
  assert.equal(fbaPoolForPhysicalCountry("SE"), "FBA_POOL_EU");
  assert.equal(fbaPoolForPhysicalCountry("GB"), "FBA_POOL_UK");
});

test("physical aggregation uses unique FNSKU grain and merges Seller SKU provenance", () => {
  const duplicate = row();
  const physical = aggregatePhysicalInventoryByUniqueFnsku("B0DJBQGKBT", [
    duplicate,
    { ...duplicate, sellerSkuRepresentations: ["alias-sku"] },
    row({ fnSku: "B0DJBQGKBT", sellerSkuRepresentations: ["uk-sku"], quantity: 624 }),
  ]);
  assert.equal(physical.physicalSellableKnownByPool.FBA_POOL_EU, 708);
  assert.equal(physical.rows.length, 2);
  assert.equal(physical.rows.find((item) => item.fnSku === "X00259GEWP")?.identityClassification, "DUPLICATE_REPRESENTATION");
  assert.deepEqual(physical.rows.find((item) => item.fnSku === "X00259GEWP")?.sellerSkuRepresentations, ["alias-sku", "f8436616610104"]);
});

test("SELLABLE and unsellable quantities remain separate", () => {
  const physical = aggregatePhysicalInventoryByUniqueFnsku("B0DJBQGKBT", [
    row({ quantity: 84 }),
    row({ disposition: "CUSTOMER_DAMAGED", quantity: 5 }),
  ]);
  assert.equal(physical.physicalSellableKnownByPool.FBA_POOL_EU, 84);
  assert.equal(physical.unsellableByPoolCountry["FBA_POOL_EU:DE"], 5);
});

test("unknown location is preserved and causes incomplete reconciliation", () => {
  const physical = aggregatePhysicalInventoryByUniqueFnsku("B0DJBQGKBT", [
    row({ location: "MAD6", locationCountry: null, quantity: 10 }),
  ]);
  assert.equal(physical.rows[0]?.country, "UNKNOWN_LOCATION");
  assert.equal(physical.unknownLocationQuantity, 10);
  assert.equal(reconcileOperationalPoolWithPhysical({
    operational: { poolId: "FBA_POOL_EU", available: 10, observedAt: "2026-08-14T05:00:00Z" },
    physical,
    now: new Date("2026-08-14T06:00:00Z"),
  }).reconciliationStatus, "INCOMPLETE_LOCATION");
});

test("matching operational and physical totals reconcile", () => {
  const physical = aggregatePhysicalInventoryByUniqueFnsku("B0DJBQGKBT", [row({ quantity: 708 })]);
  const result = reconcileOperationalPoolWithPhysical({
    operational: { poolId: "FBA_POOL_EU", available: 708, observedAt: "2026-08-14T05:00:00Z" },
    physical,
    now: new Date("2026-08-14T06:00:00Z"),
  });
  assert.equal(result.reconciliationStatus, "MATCHED");
  assert.equal(result.difference, 0);
});

test("stale physical snapshot wins over apparent stock difference", () => {
  const physical = aggregatePhysicalInventoryByUniqueFnsku("B0DJBQGKBT", [
    row({ quantity: 816, snapshotAt: "2026-06-16T00:00:00Z" }),
  ]);
  const result = reconcileOperationalPoolWithPhysical({
    operational: { poolId: "FBA_POOL_EU", available: 708, observedAt: "2026-08-14T06:01:06Z" },
    physical,
    now: new Date("2026-08-14T07:00:00Z"),
  });
  assert.equal(result.reconciliationStatus, "STALE_PHYSICAL_SOURCE");
  assert.equal(result.difference, -108);
});

test("fresh timestamp mismatch is timing difference, otherwise unexplained", () => {
  const timingPhysical = aggregatePhysicalInventoryByUniqueFnsku("B0DJBQGKBT", [
    row({ quantity: 700, snapshotAt: "2026-08-12T04:00:00Z" }),
  ]);
  assert.equal(reconcileOperationalPoolWithPhysical({
    operational: { poolId: "FBA_POOL_EU", available: 708, observedAt: "2026-08-14T05:00:00Z" },
    physical: timingPhysical,
    now: new Date("2026-08-14T05:30:00Z"),
  }).reconciliationStatus, "TIMING_DIFFERENCE");

  const currentPhysical = aggregatePhysicalInventoryByUniqueFnsku("B0DJBQGKBT", [row({ quantity: 700 })]);
  assert.equal(reconcileOperationalPoolWithPhysical({
    operational: { poolId: "FBA_POOL_EU", available: 708, observedAt: "2026-08-14T05:00:00Z" },
    physical: currentPhysical,
    now: new Date("2026-08-14T05:30:00Z"),
  }).reconciliationStatus, "UNEXPLAINED_DIFFERENCE");
});

test("conflicting physical representations are excluded and flagged", () => {
  const physical = aggregatePhysicalInventoryByUniqueFnsku("B0DJBQGKBT", [row(), row({ quantity: 85 })]);
  assert.equal(physical.physicalSellableKnownByPool.FBA_POOL_EU, 0);
  assert.equal(reconcileOperationalPoolWithPhysical({
    operational: { poolId: "FBA_POOL_EU", available: 84, observedAt: "2026-08-14T05:00:00Z" },
    physical,
    now: new Date("2026-08-14T06:00:00Z"),
  }).reconciliationStatus, "IDENTITY_CONFLICT");
});

test("ALAIA operational available remains 708", () => {
  const physical = aggregatePhysicalInventoryByUniqueFnsku("B0DJBQGKBT", [
    row({ fnSku: "X00259GEWP", quantity: 84 }),
    row({ fnSku: "B0DJBQGKBT", quantity: 624 }),
  ]);
  assert.equal(physical.physicalSellableKnownByPool.FBA_POOL_EU, 708);
});
