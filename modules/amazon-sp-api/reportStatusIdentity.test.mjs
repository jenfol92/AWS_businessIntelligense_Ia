import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertAmazonReportId } from "./reportIdentityPolicy.ts";

test("local job UUID is rejected before Amazon getReport", () => {
  assert.throws(() => assertAmazonReportId("cf745a5d-e6de-47a3-af85-76a0d0112440"), /local job UUID/);
  assert.doesNotThrow(() => assertAmazonReportId("1234567890123"));
});

test("status owner loads local job and passes job.report_id to Amazon", async () => {
  const source = await readFile("modules/amazon-sp-api/fbaCountryReportService.ts", "utf8");
  assert.match(source, /getReportJobById\(jobId\)/);
  assert.match(source, /getReport\(job\.report_id\)/);
  assert.doesNotMatch(source, /getReport\(jobId\)/);
});

test("country diagnostic cannot create a live report", async () => {
  const source = await readFile("app/api/diagnostics/sp-api/reports/fba-country/route.ts", "utf8");
  assert.doesNotMatch(source, /createReport\(/);
});
