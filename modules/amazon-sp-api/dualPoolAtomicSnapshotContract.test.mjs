import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "sql/migrations/20260820_01_amazon_fba_dual_pool_atomic_contract.sql"),
  "utf8",
);
const latestReadyMigration = fs.readFileSync(
  path.join(root, "sql/migrations/20260903_02_latest_fba_publication_ready_only.sql"),
  "utf8",
);
const importer = fs.readFileSync(
  path.join(root, "modules/amazon-sp-api/fbaForecastSpApiImportsService.ts"),
  "utf8",
);
const syncOwner = fs.readFileSync(
  path.join(root, "modules/amazon-sp-api/amazonInventoryCanonicalSyncService.ts"),
  "utf8",
);
const readModel = fs.readFileSync(
  path.join(root, "modules/inventory/services/amazonCanonicalInventoryReadModel.ts"),
  "utf8",
);

test("dual contract uses canonical physical identity including operational pool", () => {
  assert.match(migration, /DROP INDEX IF EXISTS public\.uq_amz_fba_inventory_canonical_grain;/);
  assert.match(migration, /snapshot_run_id, producto_id, operational_pool, asin, fnsku/);
  assert.doesNotMatch(migration, /CREATE UNIQUE INDEX[\s\S]*seller_sku_original/);
});

test("dual RPC requires both pools complete, zero conflicts and publication readiness", () => {
  assert.match(migration, /p_pan_eu_complete IS DISTINCT FROM true/);
  assert.match(migration, /p_uk_complete IS DISTINCT FROM true/);
  assert.match(migration, /COALESCE\(p_identity_conflict_count, 0\) <> 0/);
  assert.match(migration, /p_ready_for_atomic_publication IS DISTINCT FROM true/);
  assert.match(migration, /DUAL_POOL_PUBLICATION_PRECONDITIONS_FAILED/);
});

test("dual RPC binds PAN_EU to ES and UK to GB and rejects other pools", () => {
  assert.match(migration, /r\.operational_pool = 'EU' AND r\.marketplace_id <> 'A1RKKUPIHCS9HS'/);
  assert.match(migration, /r\.operational_pool = 'UK' AND r\.marketplace_id <> 'A1F83G8C2ARO7P'/);
  assert.match(migration, /r\.operational_pool NOT IN \('EU', 'UK'\)/);
});

test("one transaction publishes run and rows through the strict dual RPC", () => {
  assert.match(migration, /^BEGIN;/);
  assert.match(migration, /public\.commit_amazon_fba_inventory_snapshot_run\([\s\S]*p_run_id/);
  assert.match(importer, /commit_amazon_fba_inventory_snapshot_run/);
  assert.doesNotMatch(syncOwner, /DUAL_OPERATIONAL_POOL_PUBLICATION_NOT_ENABLED/);
  assert.match(importer, /p_pan_eu_complete: panEuComplete/);
  assert.match(importer, /p_uk_complete: ukComplete/);
  assert.match(importer, /p_ready_for_atomic_publication: readyForAtomicPublication/);
});

test("read view exposes PAN_EU, UK and total with provenance", () => {
  assert.match(migration, /stock_fba_pan_eu/);
  assert.match(migration, /stock_fba_uk/);
  assert.match(migration, /stock_fba_total/);
  assert.match(migration, /GROUP BY snapshot_run_id, producto_id/);
  assert.match(readModel, /stockFbaPanEu/);
  assert.match(readModel, /stockFbaUk/);
  assert.match(readModel, /stockFbaTotal/);
});

test("shared latest view rejects partial runs for Inventory, Finance and Planner", () => {
  assert.match(latestReadyMigration, /publication_ready = true/);
  assert.match(latestReadyMigration, /identity_conflict_count = 0/);
  assert.match(latestReadyMigration, /complete_operational_pools @> ARRAY\['EU', 'UK'\]/);
  assert.match(latestReadyMigration, /JOIN latest_run r ON r\.id = s\.snapshot_run_id/);
});
