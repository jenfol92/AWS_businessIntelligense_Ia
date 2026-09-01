import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const activeRoots = ["app", "modules", "scripts", "vercel.json"];
const search = spawnSync(
  "rg",
  ["-n", "-i", "--glob", "!scripts/test-stockagile-removal.mjs", "stockagile|stockagile_orders_raw|stockagile_fbm_sales|sync_ventas_diarias_from_stockagile", ...activeRoots],
  { cwd: root, encoding: "utf8", windowsHide: true },
);
assert.ok(search.status === 0 || search.status === 1, search.stderr);
const activeMatches = search.stdout
  .split(/\r?\n/)
  .filter(Boolean);

assert.deepEqual(activeMatches, [], `Active Stockagile references remain:\n${activeMatches.join("\n")}`);
assert.equal(existsSync(path.join(root, "modules", "stockagile", "stockagileClient.ts")), false);
assert.equal(existsSync(path.join(root, "app", "api", "cron", "stockagile", "orders-to-ventas-diarias", "route.ts")), false);

const inventory = readFileSync(
  path.join(root, "modules", "inventory", "repositories", "inventoryRepository.ts"),
  "utf8",
);
assert.doesNotMatch(inventory, /stockagile_orders_raw|stockagile_fbm_sales/i);

console.log("PASS no active Stockagile code, cron, Inventory dependency or sales writer");
