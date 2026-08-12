import assert from "node:assert/strict";
import { FBA_COUNTRY_REPORT_TYPE } from "./config.ts";
import { isAmazonReportJobSupersededByImportedJob } from "./amazonReportSupersededPolicy.ts";

const FBA_LEDGER_REPORT_TYPE = "GET_LEDGER_SUMMARY_VIEW_DATA";

const oldPendingLedger = {
  report_type: FBA_LEDGER_REPORT_TYPE,
  requested_at: "2026-07-14T08:00:00.000Z",
  updated_at: "2026-07-14T08:05:00.000Z",
};
const oldPendingCountry = {
  report_type: FBA_COUNTRY_REPORT_TYPE,
  requested_at: "2026-07-14T08:00:00.000Z",
  updated_at: "2026-07-14T08:05:00.000Z",
};
const newImportedLedger = {
  report_type: FBA_LEDGER_REPORT_TYPE,
  requested_at: "2026-07-15T08:00:00.000Z",
  updated_at: "2026-07-15T08:05:00.000Z",
};
const newImportedCountry = {
  report_type: FBA_COUNTRY_REPORT_TYPE,
  requested_at: "2026-07-15T08:00:00.000Z",
  updated_at: "2026-07-15T08:05:00.000Z",
};

assert.equal(
  isAmazonReportJobSupersededByImportedJob(oldPendingLedger, newImportedCountry),
  false,
  "BY_COUNTRY nuevo no descarta Ledger antiguo pendiente",
);
assert.equal(
  isAmazonReportJobSupersededByImportedJob(oldPendingCountry, newImportedLedger),
  false,
  "Ledger nuevo no descarta BY_COUNTRY pendiente",
);
assert.equal(
  isAmazonReportJobSupersededByImportedJob(oldPendingLedger, newImportedLedger),
  true,
  "Ledger nuevo descarta Ledger mas antiguo",
);
assert.equal(
  isAmazonReportJobSupersededByImportedJob(oldPendingCountry, newImportedCountry),
  true,
  "BY_COUNTRY nuevo descarta BY_COUNTRY mas antiguo",
);
