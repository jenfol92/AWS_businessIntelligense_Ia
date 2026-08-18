import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const files=[
  "app/api/cron/amazon/fba-inventory-snapshot/route.ts",
  "app/api/amazon/inventory/fba-snapshot/import/route.ts",
];

test("existing cron and manual refreshes share one canonical service",async()=>{
  for(const file of files){const source=await readFile(file,"utf8");assert.match(source,/syncAmazonInventoryCanonical/);assert.doesNotMatch(source,/importFbaInventorySnapshotFromSpApi.*from/);}
});

test("el cron general de Reports no dispara Inventory Summaries",async()=>{
  const source=await readFile("app/api/cron/amazon/reports/run/route.ts","utf8");
  assert.doesNotMatch(source,/syncAmazonInventoryCanonical|getInventorySummaries/);
});

test("canonical sync is inventory-only and preserves last good snapshots",async()=>{
  const source=await readFile("modules/amazon-sp-api/amazonInventoryCanonicalSyncService.ts","utf8");
  const gate=await readFile("modules/amazon-sp-api/amazonInventorySyncGate.ts","utf8");
  assert.match(source,/amazon_sync_jobs/);
  assert.match(gate,/AMAZON_INVENTORY_CANONICAL_FREQUENCY_MINUTES = 240/);
  assert.doesNotMatch(source,/treasuryEngine|finance_receive|RECEIVED|cash_movements|amazonEconomicForecast/);
  assert.doesNotMatch(source,/delete\(|truncate|stock_total/);
  assert.doesNotMatch(source,/syncInboundShipmentsToAmazonEnvios|dependencies\.inbound/);
});

test("canonical owner loads only confirmed Seller SKU and batches at 50", async () => {
  const source = await readFile("modules/amazon-sp-api/amazonInventoryCanonicalSyncService.ts", "utf8");
  assert.match(source, /loadConfirmedOperationalAmazonSellerSkus/);
  assert.match(source, /sellerSkus: confirmedSellerSkus/);
  assert.match(source, /sellerSkuBatchSize: 50/);
});
