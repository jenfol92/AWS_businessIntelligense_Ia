import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const inventoryPage = read("modules/inventory/components/InventoryPage.tsx");
const cron = read("app/api/cron/amazon/fba-inventory-snapshot/route.ts");
const reportsCron = read("app/api/cron/amazon/reports/run/route.ts");
const canonicalRoute = read("app/api/amazon/inventory/fba-snapshot/import/route.ts");
const inboundRoute = read("app/api/amazon/inbound-shipments/sync/route.ts");
const reportJobs = read("modules/amazon-sp-api/reportJobsRepository.ts");
const countryReport = read("modules/amazon-sp-api/fbaCountryReportService.ts");
const ledgerReport = read("modules/amazon-sp-api/fbaLedgerReportService.ts");
const countryRoute = read("app/api/amazon/sp-api/reports/fba-country/request/route.ts");
const canonicalInventory = read("modules/inventory/services/amazonCanonicalInventory.ts");
const ledgerRoute = read("app/api/amazon/sp-api/reports/fba-ledger/run/route.ts");
const legacyLedgerRoute = read("app/api/amazon/reports/fba-ledger/import/route.ts");
const legacyForecastImports = read("modules/amazon-sp-api/fbaForecastSpApiImportsService.ts");
const ledgerLock = read("modules/amazon-sp-api/fbaLedgerExecutionLockCore.ts");
const reportScheduler = read("modules/amazon-sp-api/amazonReportSchedulerService.ts");

test("Inventory es el único trigger UI del sync canónico", () => {
  assert.match(inventoryPage, /\/api\/amazon\/inventory\/fba-snapshot\/import/);
  assert.doesNotMatch(inventoryPage, /\/importar|Ir a Importar/);
  assert.equal(existsSync("app/[locale]/(dashboard)/importar/page.tsx"), false);
  assert.equal(existsSync("modules/imports/components/AmazonInventoryCanonicalImportCard.tsx"), false);
});

test("cron delega al owner de Inventory Summaries e inbound conserva su owner separado", () => {
  assert.match(cron, /syncAmazonInventoryCanonical/);
  assert.doesNotMatch(cron, /spApiRequest|requestFilteredInventorySummaries|getInventorySummaries/);
  assert.doesNotMatch(reportsCron, /syncAmazonInventoryCanonical|getInventorySummaries/);
  assert.match(inboundRoute, /syncInboundShipmentsToAmazonEnvios/);
  assert.doesNotMatch(inboundRoute, /syncAmazonInventoryCanonical/);
  assert.doesNotMatch(inboundRoute, /spApiRequest|getInventorySummaries/);
});

test("las rutas cron fragmentadas y legacy fueron eliminadas", () => {
  for (const path of [
    "app/api/cron/amazon-sp-api/reports/route.ts",
    "app/api/cron/amazon/reports/request-due/route.ts",
    "app/api/cron/amazon/reports/poll/route.ts",
    "app/api/cron/amazon/reports/preview/route.ts",
    "app/api/cron/amazon/reports/commit/route.ts",
  ]) assert.equal(existsSync(path), false, path);
});

test("un job compatible pendiente o reciente bloquea otra solicitud", () => {
  assert.match(reportJobs, /findBlockingAmazonReportJob/);
  assert.match(reportJobs, /IN_QUEUE,IN_PROGRESS/);
  assert.match(reportJobs, /recent_success/);
  assert.match(countryReport, /findBlockingAmazonReportJob/);
  assert.match(ledgerReport, /findBlockingAmazonReportJob/);
  assert.match(ledgerReport, /dataStartTime: payload\.dataStartTime/);
});

test("un snapshot fresco y un 429 usan gate y cooldown", () => {
  const gate = read("modules/amazon-sp-api/amazonInventorySyncGate.ts");
  assert.match(gate, /skipped_fresh/);
  assert.match(gate, /skipped_rate_limit/);
  assert.match(gate, /RATE_LIMITED/);
});

test("los fallbacks manuales son headless y no una UI operativa", () => {
  assert.equal(existsSync("app/api/imports/amazon-fba-inventory-by-country/route.ts"), false);
  assert.equal(existsSync("app/api/imports/amazon-fba-ledger-summary/route.ts"), false);
  assert.equal(existsSync("modules/imports/amazon-fba-inventory-by-country/service.ts"), true);
  assert.equal(existsSync("modules/imports/amazon-fba-ledger-summary/service.ts"), true);
  assert.equal(existsSync("modules/imports/components/AmazonFbaInventoryByCountryImportCard.tsx"), false);
  assert.equal(existsSync("modules/imports/components/AmazonFbaLedgerImportCard.tsx"), false);
});

test("Ledger stale no se convierte en current fiable", () => {
  assert.match(canonicalInventory, /reliable: freshnessStatus === "FRESH"/);
  assert.match(canonicalInventory, /UNAVAILABLE/);
  assert.doesNotMatch(canonicalInventory, /stock_total|inventory_ledger/i);
});

test("las rutas UI no llaman getInventorySummaries directamente", () => {
  assert.doesNotMatch(inventoryPage, /getInventorySummaries|spApiRequest/);
  assert.doesNotMatch(canonicalRoute, /getInventorySummaries|spApiRequest/);
});

test("el importer productivo delega cada request al wrapper filtrado", () => {
  const start = legacyForecastImports.indexOf("export async function importFbaInventorySnapshotFromSpApi");
  const end = legacyForecastImports.indexOf("async function legacyFbaLedgerDailyFromSpApiDisabled");
  const inventoryOwner = legacyForecastImports.slice(start, end);
  assert.match(inventoryOwner, /requestFilteredInventorySummaries/);
  assert.doesNotMatch(inventoryOwner, /spApiRequest\s*</);
});

test("autenticación de usuario, admin y cron se conserva", () => {
  assert.match(canonicalRoute, /auth\.getUser/);
  assert.match(countryRoute, /auth\.getUser/);
  assert.match(countryRoute, /isAdminUser/);
  assert.match(cron, /CRON_SECRET/);
});

test("Finance y Planner no poseen la llamada Inventory Summaries", () => {
  const financeForecast = read("modules/finance/services/buildAmazonEconomicForecastV2.ts");
  const planner = read("modules/planner/services/getPlanningDashboard.ts");
  assert.doesNotMatch(financeForecast, /getInventorySummaries|\/fba\/inventory\/v1\/summaries/);
  assert.doesNotMatch(planner, /getInventorySummaries|\/fba\/inventory\/v1\/summaries/);
});

test("Ledger tiene un owner, un writer y un lock server-side", () => {
  assert.match(ledgerReport, /runWithFbaLedgerExecutionLock/);
  assert.match(ledgerReport, /requestFbaLedgerReportJobUnlocked/);
  assert.match(ledgerReport, /refreshFbaLedgerReportJobStatusUnlocked/);
  assert.match(ledgerReport, /downloadAndPreviewFbaLedgerReportJobUnlocked/);
  assert.match(ledgerReport, /commitFbaLedgerReportJobUnlocked/);
  assert.match(ledgerRoute, /requestFbaLedgerReportJob/);
  assert.match(legacyLedgerRoute, /requestFbaLedgerReportJob/);
  assert.doesNotMatch(legacyLedgerRoute, /createReport|getReport|getReportDocument|downloadReportDocument/);
  assert.doesNotMatch(legacyForecastImports, /export async function importFbaLedgerDailyFromSpApi/);
  assert.match(ledgerLock, /LEDGER_ALREADY_RUNNING/);
  assert.match(ledgerLock, /FBA_LEDGER_LOCK_MINUTES = 30/);
  assert.match(ledgerLock, /FBA_LEDGER_HEARTBEAT_MINUTES = 5/);
  assert.match(reportScheduler, /refreshFbaLedgerReportJobStatus\(job\.id\)/);
  assert.match(ledgerReport, /countLedgerRowsByDocumentIdentity/);
  assert.match(ledgerReport, /ALREADY_IMPORTED/);
});
