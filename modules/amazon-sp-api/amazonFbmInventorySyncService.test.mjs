import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertFbmCaptureComplete, FbmCaptureError, syncAmazonFbmInventoryCanonical } from "./amazonFbmInventorySyncService.ts";

const identity = {
  sellerSku: "merchant-alaia", asin: "B0DJBQGKBT", productoId: "00000000-0000-0000-0000-000000000001",
  skuLimpio: "8436616610104", fnsku: "X00259GEWP", confidence: "CONFIRMED",
};

function diagnostic(mfnQuantity) {
  return {
    sellerSku: identity.sellerSku, marketplaceId: "ES", asin: identity.asin,
    observedAt: "2026-09-04T10:00:00.000Z", fulfillmentAvailability: [], mfnQuantity,
    responseMetadata: null, amazonHttpCalls: 1, raw: { asin: identity.asin, fulfillmentAvailability: [] },
  };
}

test("FBM canonical sync reuses confirmed identity and Listings Items owners", async () => {
  const source = await readFile("modules/amazon-sp-api/amazonFbmInventorySyncService.ts", "utf8");
  assert.match(source, /loadCanonicalFbmProductIdentities/);
  assert.match(source, /getListingsItem/);
  assert.match(source, /FBM_REQUEST_BUDGET_EXCEEDED/);
  assert.match(source, /params\.persist === false/);
  assert.match(source, /commit_amazon_fbm_inventory_snapshot_run/);
  assert.doesNotMatch(source, /fn_stock_add|inventario_paises/);
});

test("FBM migration publishes a run and its rows atomically without touching FBA", async () => {
  const sql = await readFile("sql/migrations/20260903_01_amazon_fbm_inventory_atomic_snapshot.sql", "utf8");
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /commit_amazon_fbm_inventory_snapshot_run/);
  assert.match(sql, /v_latest_amazon_fbm_inventory_by_product/);
  assert.doesNotMatch(sql, /stock_fba|fn_stock_add/);
  assert.match(sql, /COMMIT;/);
});

test("FBM latest publication is selected independently per marketplace", async () => {
  const sql = await readFile("sql/migrations/20260903_01_amazon_fbm_inventory_atomic_snapshot.sql", "utf8");
  assert.match(sql, /SELECT DISTINCT ON \(marketplace_id\)/);
  assert.match(sql, /ORDER BY marketplace_id, observed_at DESC, completed_at DESC/);
  assert.doesNotMatch(sql, /LIMIT 1/);

  const runs = [
    { marketplace: "ES", observedAt: "2026-09-03T12:00:00Z" },
    { marketplace: "FR", observedAt: "2026-09-03T12:02:00Z" },
    { marketplace: "DE", observedAt: "2026-09-03T12:04:00Z" },
    { marketplace: "GB", observedAt: "2026-09-03T12:06:00Z" },
  ];
  const published = new Map(runs.map((run) => [run.marketplace, run]));
  assert.deepEqual([...published.keys()].sort(), ["DE", "ES", "FR", "GB"]);
  published.set("GB", { marketplace: "GB", observedAt: "2026-09-03T13:00:00Z" });
  assert.deepEqual([...published.keys()].sort(), ["DE", "ES", "FR", "GB"]);
});

test("FBM RPC enforces completeness, row validity, duplicate SKU and atomic publication", async () => {
  const sql = await readFile("sql/migrations/20260903_01_amazon_fbm_inventory_atomic_snapshot.sql", "utf8");
  assert.match(sql, /publication_ready boolean NOT NULL DEFAULT false/);
  assert.match(sql, /p_capture_complete IS DISTINCT FROM true/);
  assert.match(sql, /p_completed_identity_count <> p_expected_identity_count/);
  assert.match(sql, /FBM_CAPTURE_INCOMPLETE/);
  assert.match(sql, /FBM_DUPLICATE_SELLER_SKU/);
  assert.match(sql, /nullif\(btrim\(r\.sku_limpio\), ''\) IS NULL/);
  assert.match(sql, /nullif\(btrim\(r\.seller_sku\), ''\) IS NULL/);
  assert.match(sql, /nullif\(btrim\(r\.asin\), ''\) IS NULL/);
  assert.match(sql, /r\.marketplace_id IS DISTINCT FROM p_marketplace_id/);
  assert.match(sql, /r\.available_quantity IS NULL[\s\S]*r\.available_quantity < 0/);
  assert.match(sql, /r\.observed_at IS DISTINCT FROM p_observed_at/);
  assert.match(sql, /VALUES \([\s\S]*'COMPLETE', true[\s\S]*\);[\s\S]*INSERT INTO public\.amazon_fbm_inventory_snapshots/);
});

test("FBM service supplies explicit complete-capture evidence", async () => {
  const source = await readFile("modules/amazon-sp-api/amazonFbmInventorySyncService.ts", "utf8");
  assert.match(source, /p_expected_identity_count: expectedIdentityCount/);
  assert.match(source, /p_completed_identity_count: completedIdentityCount/);
  assert.match(source, /rows: builtCanonical\.rows\.map\(\(row\) => \(\{ \.\.\.row, observed_at: observedAt \}\)\)/);
});

test("valid non-FBM response counts completed while canonical remains smaller", async () => {
  let rpcArgs;
  const result = await syncAmazonFbmInventoryCanonical(
    { marketplaceId: "ES", maxAmazonCalls: 1 },
    { loadIdentities: async () => [identity], getItem: async () => diagnostic(null), commit: async (args) => { rpcArgs = args; return { data: 0, error: null }; } },
  );
  assert.equal(result.expectedIdentityCount, 1);
  assert.equal(result.completedIdentityCount, 1);
  assert.equal(result.canonicalRowCount, 0);
  assert.equal(rpcArgs.p_capture_complete, true);
  assert.deepEqual(rpcArgs.p_rows, []);
});

test("transport failure aborts before RPC publication", async () => {
  let commits = 0;
  await assert.rejects(() => syncAmazonFbmInventoryCanonical(
    { marketplaceId: "ES", maxAmazonCalls: 1 },
    { loadIdentities: async () => [identity], getItem: async () => { throw new Error("NETWORK_FAILURE"); }, commit: async () => { commits += 1; return { data: 0, error: null }; } },
  ), (error) => error instanceof FbmCaptureError && error.sellerSku === identity.sellerSku && error.productoId === identity.productoId && /NETWORK_FAILURE/.test(error.message));
  assert.equal(commits, 0);
});

test("completed below expected is rejected by the publication gate", () => {
  assert.throws(() => assertFbmCaptureComplete(0, 0), /FBM_EXPECTED_IDENTITY_COUNT_INVALID/);
  assert.throws(() => assertFbmCaptureComplete(2, 1), /FBM_CAPTURE_INCOMPLETE/);
  assert.doesNotThrow(() => assertFbmCaptureComplete(2, 2));
});

test("duplicate Seller SKU in the run is rejected before requests and publication", async () => {
  let calls = 0;
  let commits = 0;
  await assert.rejects(() => syncAmazonFbmInventoryCanonical(
    { marketplaceId: "ES", maxAmazonCalls: 2 },
    { loadIdentities: async () => [identity, { ...identity }], getItem: async () => { calls += 1; return diagnostic(1); }, commit: async () => { commits += 1; return { data: 0, error: null }; } },
  ), /FBM_DUPLICATE_SELLER_SKU/);
  assert.equal(calls, 0);
  assert.equal(commits, 0);
});
