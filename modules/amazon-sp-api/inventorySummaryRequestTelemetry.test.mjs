import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("el owner filtra telemetría de éxito, fallo, rate limit y paginación", async () => {
  const source = await readFile("modules/amazon-sp-api/fbaForecastSpApiImportsService.ts", "utf8");
  for (const outcome of ["SUCCESS", "FAILED", "RATE_LIMITED", "UNEXPECTED_FILTERED_PAGINATION"]) {
    assert.match(source, new RegExp(`outcome[^\\n]*${outcome}|${outcome}`));
  }
  assert.match(source, /persistTelemetry/);
  assert.match(source, /requestId/);
  assert.match(source, /observedRateLimit/);
  assert.match(source, /retryAfter/);
});

test("single-SKU diagnostic mode detiene nextToken sin pedir página siguiente", async () => {
  const source = await readFile("modules/amazon-sp-api/fbaForecastSpApiImportsService.ts", "utf8");
  assert.match(source, /paginationMode\?:\s*"normal" \| "diagnostic-stop"/);
  assert.match(source, /UNEXPECTED_FILTERED_PAGINATION/);
});

test("pagination guards repeated token, no progress and budgets", async () => {
  const source = await readFile("modules/amazon-sp-api/fbaForecastSpApiImportsService.ts", "utf8");
  assert.match(source, /INVENTORY_SUMMARY_PAGINATION_TOKEN_REPEATED/);
  assert.match(source, /INVENTORY_SUMMARY_PAGINATION_NO_PROGRESS/);
  assert.match(source, /assertInventorySummaryPageBudget/);
  assert.match(source, /assertInventorySummaryRequestBudget/);
  assert.match(source, /assertInventorySummaryRuntimeBudget/);
});

test("snapshot publication is after all requests and reconciliation", async () => {
  const source = await readFile("modules/amazon-sp-api/fbaForecastSpApiImportsService.ts", "utf8");
  const importer = source.slice(source.indexOf("export async function importFbaInventorySnapshotFromSpApi"));
  assert.ok(importer.indexOf("buildCanonicalInventorySnapshot") < importer.indexOf("commit_amazon_fba_inventory_snapshot_run"));
  assert.match(importer, /No se escribe hasta que todas las llamadas/);
});
