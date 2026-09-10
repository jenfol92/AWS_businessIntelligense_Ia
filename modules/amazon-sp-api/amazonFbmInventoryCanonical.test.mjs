import test from "node:test";
import assert from "node:assert/strict";
import { buildCanonicalFbmInventorySnapshot } from "./amazonFbmInventoryCanonical.ts";

const identity = {
  sellerSku: "merchant-alaia",
  asin: "B0DJBQGKBT",
  productoId: "p-alaia",
  skuLimpio: "8436616610104",
  fnsku: "X00259GEWP",
  confidence: "CONFIRMED",
};

test("persiste únicamente disponibilidad FBM DEFAULT con identidad confirmada", () => {
  const result = buildCanonicalFbmInventorySnapshot([
    { sellerSku: "merchant-alaia", marketplaceId: "ES", asin: "B0DJBQGKBT", observedAt: "2026-09-03T12:00:00Z", mfnQuantity: 27 },
    { sellerSku: "fba-only", marketplaceId: "ES", asin: "OTHER", observedAt: "2026-09-03T12:00:00Z", mfnQuantity: null },
  ], [identity]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].available_quantity, 27);
  assert.equal(result.ignoredNonFbm, 1);
});

test("falla cerrado ante ASIN distinto o cantidad inválida", () => {
  assert.throws(() => buildCanonicalFbmInventorySnapshot([
    { sellerSku: "merchant-alaia", marketplaceId: "ES", asin: "B0DJBQGKBT", observedAt: "2026-09-03T12:00:00Z", mfnQuantity: -1 },
  ], [identity]), /FBM_QUANTITY_INVALID/);
});

test("quantity zero is canonical and distinct Seller SKUs may resolve to one product", () => {
  const secondIdentity = { ...identity, sellerSku: "merchant-alaia-2" };
  const result = buildCanonicalFbmInventorySnapshot([
    { sellerSku: "merchant-alaia", marketplaceId: "ES", asin: "B0DJBQGKBT", observedAt: "2026-09-03T12:00:00Z", mfnQuantity: 0 },
    { sellerSku: "merchant-alaia-2", marketplaceId: "ES", asin: "B0DJBQGKBT", observedAt: "2026-09-03T12:00:00Z", mfnQuantity: 3 },
  ], [identity, secondIdentity]);
  assert.deepEqual(result.rows.map((row) => row.available_quantity), [0, 3]);
  assert.deepEqual(result.rows.map((row) => row.seller_sku), ["merchant-alaia", "merchant-alaia-2"]);
});

test("existing exact identity still aborts unmatched and ASIN conflict", () => {
  assert.throws(() => buildCanonicalFbmInventorySnapshot([
    { sellerSku: "unmatched", marketplaceId: "ES", asin: "B0DJBQGKBT", observedAt: "2026-09-03T12:00:00Z", mfnQuantity: 1 },
  ], [identity]), /FBM_IDENTITY_UNRESOLVED/);
});

test("ASIN absent remains a valid FBM row because identity is product SKU", () => {
  const result = buildCanonicalFbmInventorySnapshot([
    { sellerSku: "8436616610104", marketplaceId: "ES", asin: null, observedAt: "2026-09-03T12:00:00Z", mfnQuantity: 25 },
  ], [{ productoId: "p-alaia", sellerSku: "8436616610104", skuLimpio: "8436616610104", asin: null, fnsku: null, confidence: "CONFIRMED" }]);
  assert.equal(result.rows[0].asin, null);
  assert.equal(result.rows[0].available_quantity, 25);
});
