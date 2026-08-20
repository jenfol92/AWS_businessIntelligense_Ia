import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanonicalFnsSkuContributors,
  sumConfirmedFnsSkuQuantities,
} from "./inventorySummaryFnskuCanonical.ts";

const row = (sellerSku, fnSku, fulfillableQuantity, extra = {}) => ({
  productoId: "614e8e63-b23a-4c4f-8915-abf19a86702f",
  operationalPool: "EU",
  sellerSku,
  asin: extra.asin ?? "B0DJBQGKBT",
  fnSku,
  fulfillableQuantity,
  reservedQuantity: extra.reservedQuantity ?? (fnSku === "B0DJBQGKBT" ? 2 : 12),
  inboundWorkingQuantity: 0,
  inboundShippedQuantity: fnSku === "B0DJBQGKBT" ? 669 : 0,
  inboundReceivingQuantity: 0,
  unfulfillableQuantity: fnSku === "B0DJBQGKBT" ? 0 : 4,
  researchingQuantity: 0,
  totalQuantity: fnSku === "B0DJBQGKBT" ? 1284 : 75,
  raw: {},
});

test("real Pan-EU sample deduplicates repeated Seller SKU representation by FNSKU", () => {
  const rows = [
    row("Amazon.Found.B0DJBQGKBT", "B0DJBQGKBT", 613),
    row("f8436616610104", "X00259GEWP", 59),
    row("f8436616610104UK", "B0DJBQGKBT", 613),
  ];
  const contributors = buildCanonicalFnsSkuContributors(rows);
  const totals = sumConfirmedFnsSkuQuantities(contributors);
  assert.equal(rows.length, 3);
  assert.equal(contributors.length, 2);
  assert.deepEqual(contributors.find((c) => c.fnSku === "B0DJBQGKBT")?.sellerSkus, ["Amazon.Found.B0DJBQGKBT", "f8436616610104UK"]);
  assert.equal(totals.rawSellerSkuSum, 1285);
  assert.equal(totals.fulfillableQuantity, 672);
});

test("same product/pool/FNSKU with divergent quantities is fail-closed", () => {
  const contributors = buildCanonicalFnsSkuContributors([
    row("alias-a", "FNSKU-1", 10),
    row("alias-b", "FNSKU-1", 11),
  ]);
  assert.equal(contributors[0].status, "FNSKU_IDENTITY_CONFLICT");
  assert.equal(contributors[0].quantities, null);
  assert.equal(sumConfirmedFnsSkuQuantities(contributors).fulfillableQuantity, 0);
});

test("same ASIN with different FNSKUs sums distinct physical identities", () => {
  const contributors = buildCanonicalFnsSkuContributors([
    row("seller-a", "FNSKU-A", 10),
    row("seller-b", "FNSKU-B", 7),
  ]);
  assert.equal(contributors.length, 2);
  assert.equal(sumConfirmedFnsSkuQuantities(contributors).fulfillableQuantity, 17);
});

test("different ASINs with the same FNSKU remain separate", () => {
  const contributors = buildCanonicalFnsSkuContributors([
    row("seller-a", "SHARED-FNSKU", 10, { asin: "ASIN-A" }),
    row("seller-b", "SHARED-FNSKU", 20, { asin: "ASIN-B" }),
  ]);
  assert.equal(contributors.length, 2);
  assert.notEqual(contributors[0].identityKey, contributors[1].identityKey);
  assert.deepEqual(contributors.map((c) => c.asin).sort(), ["ASIN-A", "ASIN-B"]);
  assert.equal(sumConfirmedFnsSkuQuantities(contributors).fulfillableQuantity, 30);
});

test("PAN_EU (EU persisted label) and GB (UK persisted label) never deduplicate each other", () => {
  const eu = row("seller-eu", "FNSKU-1", 10, { asin: "ASIN-1" });
  const gb = { ...row("seller-gb", "FNSKU-1", 10, { asin: "ASIN-1" }), operationalPool: "UK" };
  const contributors = buildCanonicalFnsSkuContributors([eu, gb]);
  assert.equal(contributors.length, 2);
  assert.equal(sumConfirmedFnsSkuQuantities(contributors).fulfillableQuantity, 20);
});

test("condition is not part of product identity", () => {
  const base = row("seller-a", "FNSKU-1", 10);
  const withCondition = { ...base, sellerSku: "seller-b", raw: { condition: "CUSTOMER_DAMAGED" } };
  assert.equal(buildCanonicalFnsSkuContributors([base, withCondition]).length, 1);
});
