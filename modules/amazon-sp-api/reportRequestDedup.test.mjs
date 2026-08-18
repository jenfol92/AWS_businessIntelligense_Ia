import assert from "node:assert/strict";
import test from "node:test";
import { classifyOpenAmazonReportJob, isCompatibleAmazonReportJob, reportClaimUuid, stableReportRequestKey } from "./reportRequestDedupPolicy.ts";

const job = {
  marketplace_ids: ["DE", "ES"],
  raw: {
    requestedCreateReportPayload: {
      dataStartTime: "2026-08-12T00:00:00Z",
      dataEndTime: "2026-08-12T23:59:59Z",
      reportOptions: { aggregateByLocation: "COUNTRY" },
    },
  },
};

test("pending report is reusable only for the same marketplace scope", () => {
  assert.equal(
    isCompatibleAmazonReportJob(job, { marketplaceIds: ["ES", "DE"] }),
    true,
  );
  assert.equal(
    isCompatibleAmazonReportJob(job, { marketplaceIds: ["FR"] }),
    false,
  );
});

test("marketplace ordering produces the same atomic report claim", () => {
  const now = new Date("2026-08-13T10:00:00Z");
  const a = reportClaimUuid({ reportType: "COUNTRY", marketplaceIds: ["ES", "DE"], now });
  const b = reportClaimUuid({ reportType: "COUNTRY", marketplaceIds: ["DE", "ES"], now });
  assert.equal(a, b);
});

test("one-marketplace diagnostic and seven-marketplace operation are distinct", () => {
  assert.notEqual(
    stableReportRequestKey({ reportType: "COUNTRY", marketplaceIds: ["ES"] }),
    stableReportRequestKey({ reportType: "COUNTRY", marketplaceIds: ["ES", "FR", "DE", "IT", "GB", "PL", "SE"] }),
  );
});

test("CREATED compatible jobs are reusable without Amazon reportId", () => {
  assert.equal(isCompatibleAmazonReportJob({ marketplace_ids: ["ES", "DE"], raw: null }, { marketplaceIds: ["DE", "ES"] }), true);
});

test("stuck open jobs are diagnosed before any replacement is allowed", () => {
  assert.equal(classifyOpenAmazonReportJob({
    requestedAt: "2026-08-12T00:00:00Z",
    recentSince: new Date("2026-08-13T00:00:00Z"),
  }), "stale_open");
  assert.equal(classifyOpenAmazonReportJob({
    requestedAt: "2026-08-13T00:30:00Z",
    recentSince: new Date("2026-08-13T00:00:00Z"),
  }), "open_job");
});

test("IN_QUEUE is a blocking processing status in repository lookup", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./reportJobsRepository.ts", import.meta.url), "utf8"));
  assert.match(source, /processing_status\.in\.\(IN_QUEUE,IN_PROGRESS\)/);
});

test("Ledger request is reusable only for the same data window and options", () => {
  assert.equal(
    isCompatibleAmazonReportJob(job, {
      marketplaceIds: ["DE", "ES"],
      requestKey: {
        dataStartTime: "2026-08-12T00:00:00Z",
        dataEndTime: "2026-08-12T23:59:59Z",
        reportOptions: { aggregateByLocation: "COUNTRY" },
      },
    }),
    true,
  );
  assert.equal(
    isCompatibleAmazonReportJob(job, {
      marketplaceIds: ["DE", "ES"],
      requestKey: { dataStartTime: "2026-08-11T00:00:00Z" },
    }),
    false,
  );
});
