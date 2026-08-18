import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

test("identidades confirmadas conservan aliases y faltantes no se convierten en SKU ERP", async () => {
  let source = await readFile("modules/amazon-sp-api/operationalAmazonIdentitySet.ts", "utf8");
  source = source.replace(/export type[\s\S]*?};\r?\n/g, "").replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", `${js}\nmodule.exports={buildOperationalAmazonIdentitySet};`)(module, module.exports);
  const result = module.exports.buildOperationalAmazonIdentitySet(
    [{ productId: "p1", erpSku: "ERP-1", productName: "ALAIA" }, { productId: "p2", erpSku: "ERP-2", productName: "Missing" }],
    [
      { productId: "p1", sellerSku: "f8436616610104", aliases: ["f8436616610104UK", "Amazon.Found.B0DJBQGKBT"], asin: "B0DJBQGKBT", fnsku: "X00259GEWP", source: "LEDGER", confidence: "CONFIRMED" },
      { productId: "p1", sellerSku: "f8436616610104UK", asin: "B0DJBQGKBT", fnsku: "B0DJBQGKBT", source: "LEDGER", confidence: "CONFIRMED" },
    ],
  );
  assert.equal(result.products.length, 2);
  assert.equal(result.products[0].asin, "B0DJBQGKBT");
  assert.deepEqual(result.products[0].sellerSkus, ["Amazon.Found.B0DJBQGKBT", "f8436616610104", "f8436616610104UK"]);
  assert.deepEqual(result.products[0].knownFnskus, ["B0DJBQGKBT", "X00259GEWP"]);
  assert.equal(result.querySellerSkus.length, 3);
  assert.equal(result.coverage.productsWithConfirmedAmazonIdentity, 1);
  assert.equal(result.products[1].status, "AMAZON_IDENTITY_MISSING");
  assert.equal(result.querySellerSkus.includes("ERP-2"), false);
});
