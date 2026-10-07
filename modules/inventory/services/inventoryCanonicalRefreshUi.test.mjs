import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("existing Inventory refresh button calls canonical sync and exposes outcomes",async()=>{
  const source=await readFile("modules/inventory/components/InventoryPage.tsx","utf8");
  assert.match(source,/\/api\/amazon\/inventory\/fba-snapshot\/import/);
  assert.match(source,/onClick=\{\(\) => void refreshAmazonInventory\(\)\}/);
  assert.match(source,/disabled=\{amazonRefreshLoading\}/);
  assert.match(source,/amazonRefreshLoading\s*\?\s*\([\s\S]*?Loader2[\s\S]*?animate-spin/);
  assert.match(source,/amazonRefreshLoading\s*\?\s*["']Actualizando Amazon/);
  assert.match(source,/Amazon ha limitado temporalmente las consultas/);
  assert.match(source,/Ya hay una actualización de Amazon en curso/);
  assert.match(source,/loadList\(\)/);
});
test("canonical read model is server-side and does not use stock_total",async()=>{
  const source=await readFile("modules/inventory/services/amazonCanonicalInventoryReadModel.ts","utf8");
  assert.match(source,/import "server-only"/);
  assert.match(source,/v_latest_amazon_fba_inventory_by_product_pool/);
  assert.doesNotMatch(source,/stock_total|spApiRequest|getInventorySummaries/);
});
test("sales refresh wiring builds an inclusive 90 day range without executing in tests",async()=>{
  const source=await readFile("modules/inventory/components/InventoryPage.tsx","utf8");
  assert.match(source,/buildInclusiveDateWindow\(toDate, 90\)/);
  assert.match(source,/\/api\/amazon\/reports\/fba-sales\/import/);
  assert.match(source,/onClick=\{\(\) => void refreshAmazonSales\(\)\}/);
  assert.match(source,/body: JSON\.stringify\(salesRefreshJob \? \{jobId:salesRefreshJob\.jobId\} : range\)/);
  assert.match(source,/json\.status !== "COMPLETED"/);
  assert.match(source,/res\.status === 202/);
  const refresh=source.slice(source.indexOf("async function refreshAmazonSales"),source.indexOf("const flatProducts"));
  assert.ok(refresh.indexOf('json.status !== "COMPLETED"') < refresh.indexOf('Ventas Amazon actualizadas'));
});

test("Inventory reads only the latest complete publication-ready dual-pool run", async () => {
  const source = await readFile("modules/inventory/repositories/inventoryRepository.ts", "utf8");
  assert.match(source, /amazon_fba_inventory_snapshot_runs/);
  assert.match(source, /\.eq\("publication_ready", true\)/);
  assert.match(source, /\.contains\("complete_operational_pools", \["EU", "UK"\]\)/);
  assert.match(source, /\.eq\("identity_conflict_count", 0\)/);
  assert.match(source, /\.eq\("snapshot_run_id", latestReadyRun\.id\)/);
  const reader = source.slice(source.indexOf("export async function fetchLatestFbaInventorySnapshotByProductIds"), source.indexOf("export async function fetchLatestFbmInventorySnapshotByProductIds"));
  assert.match(reader, /\.from\("v_latest_amazon_fba_inventory_snapshot"\)/);
  assert.doesNotMatch(reader, /\.from\("amazon_fba_inventory_snapshots"\)/);
});
