import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isInventoryTimestampNotStale } from "./inventoryFreshnessPolicy.ts";

test("stale ledger and inventario_paises are last-known, not current operational stock", () => {
  const now = new Date("2026-08-13T12:00:00Z");
  assert.equal(isInventoryTimestampNotStale("2026-06-16T00:00:00Z", now), false);
  assert.equal(isInventoryTimestampNotStale("2026-07-21T11:11:00Z", now), false);
});

test("operational resolver uses Inventory Summaries and temporary country fallback, never Ledger", async () => {
  const source = await readFile("modules/inventory/services/resolveOperationalStock.ts", "utf8");
  assert.match(source, /stockFbaLatestSnapshot != null && isInventoryTimestampNotStale/);
  assert.match(source, /hasCountryInventoryRows\(inventoryRows\)/);
  assert.match(source, /isInventoryTimestampNotStale\(stockFbaAppLatestUpdatedAt, now\)/);
  assert.match(source, /!snapshotIdentityConflict/);
  assert.doesNotMatch(source, /return "ledger"/);
  assert.doesNotMatch(source, /case "ledger"/);
});
