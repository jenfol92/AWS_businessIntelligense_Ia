import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  FBA_LEDGER_DAILY_FREQUENCY_MINUTES,
  FBA_LEDGER_PHYSICAL_STALE_AFTER_HOURS,
  FBA_LEDGER_SCHEDULE_MARKETPLACE_COUNTRY,
  FBA_LEDGER_SCHEDULE_MARKETPLACE_ID,
  fbaLedgerUtcDayBounds,
  lastCompleteFbaLedgerUtcDay,
} from "./fbaLedgerSchedulePolicy";

const read = (path: string) => readFileSync(path, "utf8");

test("Ledger diario usa el ultimo dia UTC completo", () => {
  assert.equal(
    lastCompleteFbaLedgerUtcDay(new Date("2026-08-14T00:05:00Z")),
    "2026-08-13",
  );
  assert.deepEqual(fbaLedgerUtcDayBounds("2026-08-13"), {
    dataStartTime: "2026-08-13T00:00:00Z",
    dataEndTime: "2026-08-13T23:59:59Z",
  });
});

test("schedule Ledger es unico, diario y usa scope EU sin marketplace individual", () => {
  assert.equal(FBA_LEDGER_DAILY_FREQUENCY_MINUTES, 1440);
  assert.equal(FBA_LEDGER_SCHEDULE_MARKETPLACE_COUNTRY, "EU");
  assert.equal(FBA_LEDGER_SCHEDULE_MARKETPLACE_ID, null);
  assert.equal(FBA_LEDGER_PHYSICAL_STALE_AFTER_HOURS, 72);
  const seed = read("sql/data/20260814_activate_daily_fba_ledger_schedule.sql");
  assert.match(seed, /GET_LEDGER_SUMMARY_VIEW_DATA/);
  assert.match(seed, /frequency_minutes\s*=\s*1440/);
  assert.match(seed, /marketplace_country\s*=\s*'EU'/);
  assert.match(seed, /marketplace_id\s*=\s*NULL/);
  assert.doesNotMatch(seed, /GET_AFN_INVENTORY_DATA_BY_COUNTRY/);
});

test("cron existente orquesta poll preview commit y request sin owner paralelo", () => {
  const vercel = read("vercel.json");
  const scheduler = read("modules/amazon-sp-api/amazonReportSchedulerService.ts");
  const route = read("app/api/cron/amazon/reports/run/route.ts");
  assert.match(vercel, /\/api\/cron\/amazon\/reports\/run/);
  assert.match(route, /runSafeAmazonReportScheduler/);
  const poll = scheduler.indexOf("pollPendingAmazonReportJobs()");
  const preview = scheduler.indexOf("previewReadyAmazonReportJobs()");
  const commit = scheduler.indexOf("commitReadyAmazonReportJobs()");
  const request = scheduler.indexOf("requestDueAmazonReportSchedules()");
  assert.ok(poll < preview && preview < commit && commit < request);
  assert.match(scheduler, /requestFbaLedgerReportJob\(/);
  assert.match(scheduler, /downloadAndPreviewFbaLedgerReportJob\(/);
  assert.match(scheduler, /commitFbaLedgerReportJob\(/);
  assert.doesNotMatch(route, /createReport\(|getReportDocument\(|downloadReportDocument\(/);
});

test("unlinked y UNKNOWN no bloquean commit; conflictos y warnings si", () => {
  const scheduler = read("modules/amazon-sp-api/amazonReportSchedulerService.ts");
  const gate = scheduler.slice(
    scheduler.indexOf("function passesCommitGateByReportType"),
    scheduler.indexOf("async function requestDueAmazonReportSchedule"),
  );
  assert.match(
    gate,
    /if \(reportType === FBA_LEDGER_REPORT_TYPE\) \{\s*return warnings === 0 && \(numberFromSummary\(summary, "conflictRows"\) \?\? 0\) === 0;\s*\}/,
  );
  assert.doesNotMatch(gate, /unknownConditionRows/);
});

test("owner conserva una llamada multinacional y deduplicacion por fecha/opciones", () => {
  const owner = read("modules/amazon-sp-api/fbaLedgerReportService.ts");
  assert.match(owner, /aggregateByLocation:\s*"COUNTRY"/);
  assert.match(owner, /aggregatedByTimePeriod:\s*"DAILY"/);
  assert.match(owner, /findBlockingAmazonReportJob/);
  assert.match(owner, /claimReportRequestJob/);
  assert.match(owner, /dataStartTime:\s*payload\.dataStartTime/);
  assert.match(owner, /dataEndTime:\s*payload\.dataEndTime/);
  assert.match(owner, /reportOptions:\s*payload\.reportOptions/);
  assert.match(owner, /skipUnlinkedProducts:\s*true/);
  assert.match(owner, /ALREADY_IMPORTED/);
});
