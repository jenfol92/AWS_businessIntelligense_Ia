import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildFbmProductIdentities } from "./fbmProductIdentityRepository.ts";

test("FBM uses exactly one productos.sku identity per audited product", () => {
  const products = Array.from({ length: 45 }, (_, i) => ({ id: `p-${i}`, sku: `SKU-${i}`, asin: "B0DJBQGKBT", estado: "activo" }));
  const result = buildFbmProductIdentities(products);
  assert.equal(result.length, 45);
  assert.deepEqual(result.find((row) => row.productoId === "p-0"), {
    productoId: "p-0", sellerSku: "SKU-0", skuLimpio: "SKU-0", asin: null, fnsku: null, confidence: "CONFIRMED",
  });
});

test("ALAIA FBM SKU is the exact product master SKU, never an alias", () => {
  const result = buildFbmProductIdentities([{ id: "614e8e63-b23a-4c4f-8915-abf19a86702f", sku: "8436616610104", asin: "B0DJBQGKBT", estado: "activo" }]);
  assert.equal(result[0].sellerSku, "8436616610104");
  assert.notEqual(result[0].sellerSku, "f8436616610104");
  assert.notEqual(result[0].sellerSku, "Amazon.Found.B0DJBQGKBT");
});

test("duplicate product master SKU is rejected", () => {
  assert.throws(() => buildFbmProductIdentities([{ id: "p1", sku: "same", asin: "B0DJBQGKBT", estado: "activo" }, { id: "p2", sku: "same", asin: "B0DJBQGKBT", estado: "activo" }]), /FBM_DUPLICATE_PRODUCT_SKU/);
});

test("Amazon activation requires a non-empty ASIN and active status", () => {
  const result = buildFbmProductIdentities([
    { id: "ok", sku: "OK", asin: "B0DJBQGKBT", estado: "activo" },
    { id: "null", sku: "NULL", asin: null, estado: "activo" },
    { id: "empty", sku: "EMPTY", asin: "  ", estado: "activo" },
    { id: "inactive", sku: "INACTIVE", asin: "B", estado: "borrador" },
  ]);
  assert.deepEqual(result.map((row) => row.sellerSku), ["OK"]);
});

test("loader does not scope FBM through the FBA ledger", async () => {
  const source = await readFile("modules/amazon-sp-api/fbmProductIdentityRepository.ts", "utf8");
  assert.doesNotMatch(source, /amazon_fba_inventory_ledger_daily|msku_aliases/);
  assert.match(source, /from\("productos"\)/);
  assert.match(source, /eq\("estado", "activo"\)/);
});
