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
  assert.match(source,/loadAmazonHealth\(\)/);
  assert.match(source,/loadList\(\)/);
});
test("canonical read model is server-side and does not use stock_total",async()=>{
  const source=await readFile("modules/inventory/services/amazonCanonicalInventoryReadModel.ts","utf8");
  assert.match(source,/import "server-only"/);
  assert.match(source,/v_latest_amazon_fba_inventory_by_product_pool/);
  assert.doesNotMatch(source,/stock_total|spApiRequest|getInventorySummaries/);
});
