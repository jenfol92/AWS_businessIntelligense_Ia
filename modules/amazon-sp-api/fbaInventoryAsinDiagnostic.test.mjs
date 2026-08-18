import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAmazonInventoryIdentityPairs,
  reconcileReturnedRowsForAsin,
  resolveAmazonInventoryIdentitiesForAsin,
  sellerSkusForAsinRequest,
} from "./fbaInventoryAsinDiagnostic.ts";

test("ALAIA resolves all locally evidenced identities without inventing marketplace", () => {
  const rows = resolveAmazonInventoryIdentitiesForAsin("B0DJBQGKBT");
  assert.equal(rows.length, 4);
  assert.deepEqual(sellerSkusForAsinRequest(rows), [
    "Amazon.Found.B0DJBQGKBT",
    "f8436616610104",
    "f8436616610104UK",
  ]);
  assert.deepEqual(new Set(rows.map((row) => row.fnSku)), new Set(["X00259GEWP", "B0DJBQGKBT"]));
  assert.ok(rows.every((row) => row.marketplace === null));
});

test("same FNSKU and matching snapshot stays unknown and is never auto-deduplicated", () => {
  const rows = resolveAmazonInventoryIdentitiesForAsin("B0DJBQGKBT");
  const pair = buildAmazonInventoryIdentityPairs(rows).find(({ left, right }) =>
    new Set([left.sellerSku, right.sellerSku]).has("f8436616610104UK") &&
    new Set([left.sellerSku, right.sellerSku]).has("Amazon.Found.B0DJBQGKBT"),
  );
  assert.equal(pair?.relationship, "SAME_FNSKU_UNKNOWN");
  assert.ok(pair?.duplicateEvidence.includes("SAME_QUANTITY"));
  assert.ok(pair?.duplicateEvidence.includes("MATCHING_SNAPSHOT"));
});

test("all ALAIA Seller SKUs fit in one getInventorySummaries request", () => {
  const skus = sellerSkusForAsinRequest(resolveAmazonInventoryIdentitiesForAsin("B0DJBQGKBT"));
  assert.equal(skus.length, 3);
  assert.ok(skus.length <= 50);
});

const operationalRow = ({ sellerSku, fnSku, available, reserved = 0, working = 0, shipped = 0, receiving = 0, unfulfillable = 0, researching = 0, totalQuantity, lastUpdatedTime = "2026-08-14T04:00:00Z" }) => ({
  marketplace: "ES",
  asin: "B0DJBQGKBT",
  sellerSku,
  fnSku,
  quantities: {
    fulfillableQuantity: available,
    totalReservedQuantity: reserved,
    inboundWorkingQuantity: working,
    inboundShippedQuantity: shipped,
    inboundReceivingQuantity: receiving,
    totalUnfulfillableQuantity: unfulfillable,
    totalResearchingQuantity: researching,
    totalQuantity: totalQuantity ?? available + reserved + working + shipped + receiving + unfulfillable + researching,
  },
  lastUpdatedTime,
});

test("different FNSKUs are summed while inbound, reserved and unfulfillable stay separate", () => {
  const result = reconcileReturnedRowsForAsin("B0DJBQGKBT", [
    operationalRow({ sellerSku: "sku-a", fnSku: "FNSKU-A", available: 10, reserved: 2, shipped: 7, unfulfillable: 3 }),
    operationalRow({ sellerSku: "sku-b", fnSku: "FNSKU-B", available: 4, reserved: 1, working: 5, receiving: 6, unfulfillable: 2 }),
  ]);
  assert.equal(result.availableFba, 14);
  assert.equal(result.reservedFba, 3);
  assert.deepEqual(result.inbound, { working: 5, shipped: 7, receiving: 6, total: 18 });
  assert.equal(result.unfulfillableFba, 5);
  assert.equal(result.uniqueFnskuCount, 2);
  assert.equal(result.inventoryConfidence, "TRUSTED");
});

test("identical Seller SKU representations of one FNSKU count once and retain raw provenance", () => {
  const duplicate = operationalRow({ sellerSku: "sku-a", fnSku: "FNSKU-A", available: 10, reserved: 2 });
  const result = reconcileReturnedRowsForAsin("B0DJBQGKBT", [
    duplicate,
    { ...duplicate, sellerSku: "sku-alias", quantities: { ...duplicate.quantities } },
  ]);
  assert.equal(result.availableFba, 10);
  assert.equal(result.reservedFba, 2);
  assert.equal(result.uniqueFnskuCount, 1);
  assert.equal(result.sellerSkuRepresentationCount, 2);
  assert.equal(result.rawIdentities.length, 2);
  assert.ok(result.rows.every((row) => row.inventoryClassification === "DUPLICATE_REPRESENTATION"));
});

test("conflicting signatures for one FNSKU are excluded and explicitly flagged", () => {
  const result = reconcileReturnedRowsForAsin("B0DJBQGKBT", [
    operationalRow({ sellerSku: "sku-a", fnSku: "FNSKU-A", available: 10 }),
    operationalRow({ sellerSku: "sku-alias", fnSku: "FNSKU-A", available: 11 }),
  ]);
  assert.equal(result.inventoryConfidence, "FNSKU_CONFLICT");
  assert.deepEqual(result.conflictingFnskus, ["FNSKU-A"]);
  assert.equal(result.availableFba, 0);
  assert.equal(result.asinTotal, "UNKNOWN");
  assert.ok(result.rows.every((row) => row.inventoryClassification === "FNSKU_CONFLICT"));
});

test("ALAIA aggregates two unique FNSKUs without double-counting duplicate Seller SKUs", () => {
  const fnskuAsin = operationalRow({
    sellerSku: "f8436616610104UK", fnSku: "B0DJBQGKBT", available: 624,
    reserved: 3, shipped: 669, totalQuantity: 1296, lastUpdatedTime: "2026-08-13T17:36:07Z",
  });
  const result = reconcileReturnedRowsForAsin("B0DJBQGKBT", [
    operationalRow({
      sellerSku: "f8436616610104", fnSku: "X00259GEWP", available: 84,
      reserved: 5, unfulfillable: 5, totalQuantity: 94, lastUpdatedTime: "2026-08-14T04:06:21Z",
    }),
    fnskuAsin,
    { ...fnskuAsin, sellerSku: "Amazon.Found.B0DJBQGKBT", quantities: { ...fnskuAsin.quantities } },
  ]);
  assert.equal(result.availableFba, 708);
  assert.equal(result.reservedFba, 8);
  assert.equal(result.inbound.total, 669);
  assert.equal(result.inbound.shipped, 669);
  assert.equal(result.unfulfillableFba, 5);
  assert.equal(result.uniqueFnskuCount, 2);
  assert.equal(result.sellerSkuRepresentationCount, 3);
  assert.equal(result.inventoryConfidence, "TRUSTED");
});
