import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("ALAIA FBM diagnostic uses the product master SKU, never FBA aliases", async () => {
  const source = await readFile("app/api/diagnostics/sp-api/listings-item-fbm/route.ts", "utf8");
  assert.match(source, /ALAIA_FBM_PRODUCT_SKU = "8436616610104"/);
  assert.match(source, /sellerSku: ALAIA_FBM_PRODUCT_SKU/);
  assert.doesNotMatch(source, /f8436616610104|Amazon\.Found\.B0DJBQGKBT/);
});
