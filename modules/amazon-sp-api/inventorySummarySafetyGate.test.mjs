import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("botón y cron están cerrados sin camino full-catalog", async () => {
  const [ui, route, cron] = await Promise.all([
    readFile("modules/inventory/components/InventoryPage.tsx", "utf8"),
    readFile("app/api/amazon/inventory/fba-snapshot/import/route.ts", "utf8"),
    readFile("app/api/cron/amazon/fba-inventory-snapshot/route.ts", "utf8"),
  ]);
  assert.match(ui, /ACTUALIZACIÓN TEMPORALMENTE BLOQUEADA/);
  assert.match(route, /INVENTORY_REFRESH_TEMPORARILY_GATED/);
  assert.match(cron, /INVENTORY_REFRESH_TEMPORARILY_GATED/);
});

test("sin snapshot no se presenta cero ni se afirma último snapshot", async () => {
  const ui = await readFile("modules/inventory/components/InventoryPage.tsx", "utf8");
  assert.match(ui, /NO DISPONIBLE \/ SIN SNAPSHOT/);
  assert.match(ui, /Todavía no existe un snapshot operativo válido/);
  assert.match(ui, /Sin snapshot COMPLETE/);
});

test("telemetría persiste respuesta y fallo sin secretos", async () => {
  const [repository, migration] = await Promise.all([
    readFile("modules/amazon-sp-api/inventorySummaryRequestTelemetry.ts", "utf8"),
    readFile("sql/migrations/20260817_01_inventory_summary_request_telemetry.sql", "utf8"),
  ]);
  for (const field of ["attempt_id", "request_sequence", "http_status", "amazon_request_id", "observed_rate_limit", "retry_after", "next_token_present", "result_count", "outcome"]) {
    assert.match(repository + migration, new RegExp(field));
  }
  assert.doesNotMatch(repository + migration, /access_token|client_secret|refresh_token/i);
  assert.match(migration, /RATE_LIMITED/);
  assert.match(migration, /UNEXPECTED_FILTERED_PAGINATION/);
});

test("Ledger conserva el contrato físico COUNTRY", async () => {
  const ledger = await readFile("modules/amazon-sp-api/fbaLedgerReportService.ts", "utf8");
  assert.match(ledger, /aggregateByLocation:\s*"COUNTRY"/);
});
