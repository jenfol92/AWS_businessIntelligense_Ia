import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("la siguiente prueba queda preparada como una sola ES sin ejecutar Amazon", async () => {
  const source = await readFile("modules/amazon-sp-api/inventorySummarySingleSkuLivePlan.ts", "utf8");
  assert.match(source, /sellerSku: "f8436616610104"/);
  assert.match(source, /sellerSkuBatchSize: 1/);
  assert.match(source, /maxAmazonRequests: 1/);
  assert.match(source, /paginationMode: "diagnostic-stop"/);
  assert.match(source, /publishSnapshot: false/);
});
