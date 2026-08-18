import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

async function loadModule(path) {
  let source = await readFile(path, "utf8");
  source = source.replace(/^import .*?;\r?\n/gm, "").replace(/export /g, "");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", `${js}\nmodule.exports={buildFilteredInventorySummaryQuery,InventorySummaryRequestPacer,inventorySummarySellerSkuBatchSize,DEFAULT_INVENTORY_SUMMARY_SELLER_SKU_BATCH_SIZE,splitSellerSkuBatches};`)(require, module, module.exports);
  return module.exports;
}

const sourcePath = "modules/amazon-sp-api/inventorySummaryFilteredRequest.ts";

test("serializa sellerSkus de 1, 2, 5 y 48 elementos en una sola query comma-separated", async () => {
  const { buildFilteredInventorySummaryQuery } = await loadModule(sourcePath);
  for (const count of [1, 2, 5, 48]) {
    const skus = Array.from({ length: count }, (_, index) => `SKU ${index + 1}`);
    const query = buildFilteredInventorySummaryQuery({ marketplaceId: "A1RKKUPIHCS9HS", sellerSkus: skus });
    const url = new URL("/fba/inventory/v1/summaries", "https://sellingpartnerapi-eu.amazon.com");
    Object.entries(query).forEach(([key, value]) => value && url.searchParams.set(key, value));
    console.log(`${count} SKU => ${url.toString()}`);
    assert.equal(url.searchParams.get("sellerSkus"), skus.join(","));
    assert.equal(url.searchParams.get("marketplaceIds"), "A1RKKUPIHCS9HS");
  }
});

test("135 Seller SKU se dividen en batches 50/50/35", async () => {
  const { splitSellerSkuBatches } = await loadModule(sourcePath);
  const batches = splitSellerSkuBatches(Array.from({ length: 135 }, (_, index) => `SKU-${index}`), 50);
  assert.deepEqual(batches.map((batch) => batch.length), [50, 50, 35]);
});

test("un batch de 51 Seller SKU se rechaza", async () => {
  const { splitSellerSkuBatches } = await loadModule(sourcePath);
  assert.throws(() => splitSellerSkuBatches(["SKU"], 51), /INVALID_INVENTORY_SUMMARY_BATCH_SIZE/);
});

test("el pacer central mantiene concurrencia uno y 1000 ms entre inicios", async () => {
  const { InventorySummaryRequestPacer } = await loadModule(sourcePath);
  let now = 0;
  let active = 0;
  let maxActive = 0;
  const starts = [];
  const pacer = new InventorySummaryRequestPacer(1000, () => now, async (ms) => { now += ms; });
  const operation = async () => { starts.push(now); active += 1; maxActive = Math.max(maxActive, active); active -= 1; };
  await Promise.all([pacer.run(operation), pacer.run(operation), pacer.run(operation)]);
  assert.equal(maxActive, 1);
  assert.deepEqual(starts, [0, 1000, 2000]);
});

test("el limite contractual permite 50 y rechaza 51; rollout puede forzar 1", async () => {
  const { inventorySummarySellerSkuBatchSize, DEFAULT_INVENTORY_SUMMARY_SELLER_SKU_BATCH_SIZE } = await loadModule(sourcePath);
  assert.equal(DEFAULT_INVENTORY_SUMMARY_SELLER_SKU_BATCH_SIZE, 50);
  assert.equal(inventorySummarySellerSkuBatchSize("50"), 50);
  assert.equal(inventorySummarySellerSkuBatchSize("1"), 1);
  assert.throws(() => inventorySummarySellerSkuBatchSize("51"), /INVALID_INVENTORY_SUMMARY_BATCH_SIZE/);
});

test("el owner filtrado nunca construye full catalog", async () => {
  const source = await readFile("modules/amazon-sp-api/fbaForecastSpApiImportsService.ts", "utf8");
  const inventoryOwner = source.slice(source.indexOf("export async function importFbaInventorySnapshotFromSpApi"), source.indexOf("async function legacyFbaLedgerDailyFromSpApiDisabled"));
  assert.match(inventoryOwner, /FILTERED_INVENTORY_REQUIRES_CONFIRMED_SELLER_SKUS/);
  assert.match(inventoryOwner, /requestFilteredInventorySummaries/);
  assert.doesNotMatch(inventoryOwner, /spApiRequest<InventorySummariesResponse>/);
});
