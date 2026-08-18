import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";

import {
  compareInventoryMarketplaceSignatures,
  getSingleSkuInventoryMarketplaceSignature,
  safeSingleSkuDiagnosticError,
} from "./fbaInventorySingleSkuDiagnostic.ts";

const apiRow = (overrides = {}) => ({
  sellerSku: "8436616610104",
  asin: "B0DJBQGKBT",
  fnSku: "X00259GEWP",
  lastUpdatedTime: "2026-08-13T12:00:00Z",
  totalQuantity: 124,
  inventoryDetails: {
    fulfillableQuantity: 100,
    reservedQuantity: {
      totalReservedQuantity: 8,
      pendingCustomerOrderQuantity: 4,
      pendingTransshipmentQuantity: 2,
      fcProcessingQuantity: 2,
    },
    inboundWorkingQuantity: 3,
    inboundShippedQuantity: 5,
    inboundReceivingQuantity: 6,
    unfulfillableQuantity: { totalUnfulfillableQuantity: 1 },
    researchingQuantity: { totalResearchingQuantity: 1 },
  },
  ...overrides,
});

async function run(marketplace, response, capture = {}) {
  return getSingleSkuInventoryMarketplaceSignature({
    marketplace,
    sellerSku: "8436616610104",
    request: async (input) => {
      capture.input = input;
      capture.calls = (capture.calls ?? 0) + 1;
      input.onResponseMetadata?.({
        operation: input.operation,
        status: 200,
        observedRateLimit: "2.0",
        retryAfter: null,
        requestId: "safe-request-id",
        observedAt: "2026-08-13T12:00:01Z",
      });
      return response;
    },
    persistTelemetry: async (row) => {
      capture.telemetry = [...(capture.telemetry ?? []), row];
    },
  });
}

test("single-SKU diagnostic sends the exact one-marketplace request", async () => {
  const capture = {};
  const result = await run("ES", { payload: { inventorySummaries: [apiRow()] } }, capture);
  assert.equal(capture.calls, 1);
  assert.deepEqual(capture.input.query, {
    sellerSkus: "8436616610104",
    details: "true",
    granularityType: "Marketplace",
    granularityId: "A1RKKUPIHCS9HS",
    marketplaceIds: "A1RKKUPIHCS9HS",
  });
  assert.equal(capture.input.rateLimitRetry.maxRetries, 0);
  assert.equal(capture.input.retryExpiredAccessToken, false);
  assert.equal(result.amazonHttpCalls, 1);
  assert.equal(result.signatures[0].fulfillableQuantity, 100);
});

test("unexpected nextToken stops without pagination", async () => {
  const capture = {};
  const result = await run("DE", {
    payload: { inventorySummaries: [apiRow()] },
    pagination: { nextToken: "do-not-follow" },
  }, capture);
  assert.equal(capture.calls, 1);
  assert.equal(result.status, "UNEXPECTED_PAGINATION");
  assert.equal(result.nextTokenPresent, true);
  assert.equal("nextToken" in capture.input.query, false);
});

test("429, 403 and 5xx are not retried by the diagnostic", async () => {
  for (const status of [429, 403, 503]) {
    let calls = 0;
    const telemetry = [];
    await assert.rejects(() => getSingleSkuInventoryMarketplaceSignature({
      marketplace: "ES",
      sellerSku: "8436616610104",
      request: async () => {
        calls += 1;
        throw Object.assign(new Error(`HTTP ${status}`), { status });
      },
      persistTelemetry: async (row) => telemetry.push(row),
    }));
    assert.equal(calls, 1);
    assert.equal(telemetry.length, 1);
    assert.equal(telemetry[0].outcome, status === 429 ? "RATE_LIMITED" : "FAILED");
  }
});

test("single-SKU success persists exactly one telemetry row with sequence 1", async () => {
  const capture = {};
  await run("ES", { payload: { inventorySummaries: [apiRow()] } }, capture);
  assert.equal(capture.telemetry.length, 1);
  assert.equal(capture.telemetry[0].requestSequence, 1);
  assert.equal(capture.telemetry[0].outcome, "SUCCESS");
  assert.equal(capture.telemetry[0].sellerSkuCount, 1);
});

test("network error persists FAILED telemetry without retry", async () => {
  let calls = 0;
  const telemetry = [];
  await assert.rejects(() => getSingleSkuInventoryMarketplaceSignature({
    marketplace: "ES",
    sellerSku: "8436616610104",
    request: async () => { calls += 1; throw new TypeError("network error"); },
    persistTelemetry: async (row) => telemetry.push(row),
  }));
  assert.equal(calls, 1);
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].outcome, "FAILED");
});

test("unexpected pagination persists telemetry and never requests page 2", async () => {
  const capture = {};
  const result = await run("ES", {
    payload: { inventorySummaries: [apiRow()] },
    pagination: { nextToken: "do-not-follow" },
  }, capture);
  assert.equal(result.status, "UNEXPECTED_PAGINATION");
  assert.equal(capture.calls, 1);
  assert.equal(capture.telemetry.length, 1);
  assert.equal(capture.telemetry[0].nextTokenPresent, true);
  assert.equal(capture.telemetry[0].outcome, "UNEXPECTED_FILTERED_PAGINATION");
});

test("identical exact Seller SKU/FNSKU signatures are IDENTICAL", async () => {
  const a = await run("ES", { payload: { inventorySummaries: [apiRow()] } });
  const b = await run("DE", { payload: { inventorySummaries: [apiRow()] } });
  const comparison = compareInventoryMarketplaceSignatures(a, b);
  assert.equal(comparison.result, "IDENTICAL");
  assert.equal(comparison.asinIdentity[0].aggregated, false);
});

test("quantity differences are reported field by field", async () => {
  const a = await run("ES", { payload: { inventorySummaries: [apiRow()] } });
  const b = await run("DE", {
    payload: { inventorySummaries: [apiRow({ inventoryDetails: { ...apiRow().inventoryDetails, fulfillableQuantity: 99 } })] },
  });
  const comparison = compareInventoryMarketplaceSignatures(a, b);
  assert.equal(comparison.result, "DIFFERENT");
  assert.deepEqual(comparison.exactIdentity.differences.find((item) => item.field === "fulfillableQuantity"), {
    identity: "B0DJBQGKBT|8436616610104|X00259GEWP",
    field: "fulfillableQuantity",
    a: 100,
    b: 99,
  });
});

test("same ASIN with different Seller SKU/FNSKU remains distinct and is never summed", async () => {
  const a = await run("ES", { payload: { inventorySummaries: [apiRow()] } });
  const b = await run("DE", {
    payload: { inventorySummaries: [apiRow({ sellerSku: "f8436616610104UK", fnSku: "B0DJBQGKBT" })] },
  });
  const comparison = compareInventoryMarketplaceSignatures(a, b);
  assert.equal(comparison.result, "DIFFERENT");
  assert.equal(comparison.exactIdentity.onlyInA.length, 1);
  assert.equal(comparison.exactIdentity.onlyInB.length, 1);
  assert.equal(comparison.asinIdentity[0].aggregated, false);
});

test("missing identity or unexpected pagination produces INCOMPLETE", async () => {
  const a = await run("ES", { payload: { inventorySummaries: [apiRow({ fnSku: null })] } });
  const b = await run("DE", { payload: { inventorySummaries: [apiRow()] } });
  assert.equal(compareInventoryMarketplaceSignatures(a, b).result, "INCOMPLETE");
});

test("strict diagnostic disables both rate-limit and expired-token replay", async () => {
  const source = await readFile(new URL("./spApiClient.ts", import.meta.url), "utf8");
  assert.match(source, /retryExpiredAccessToken\?: boolean/);
  assert.match(source, /input\.retryExpiredAccessToken === false/);
  const diagnostic = await readFile(new URL("./fbaInventorySingleSkuDiagnostic.ts", import.meta.url), "utf8");
  assert.match(diagnostic, /rateLimitRetry: \{ maxRetries: 0 \}/);
  assert.match(diagnostic, /retryExpiredAccessToken: false/);
  assert.doesNotMatch(diagnostic, /nextToken\s*[,}:]/);
});

test("diagnostic route has no canonical, inbound or report dependency and uses existing telemetry", async () => {
  const route = await readFile(new URL("../../app/api/diagnostics/sp-api/inventory-summary/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /syncAmazonInventoryCanonical|inbound|createReport|getReport/i);
  assert.match(route, /persistInventorySummaryRequestTelemetry/);
});

function nativeFetchFailure(cause) {
  const error = new TypeError("fetch failed");
  error.cause = cause;
  return error;
}

function mappedFetchFailure(cause, layer) {
  const source = nativeFetchFailure(cause);
  return Object.assign(new Error("Upstream fetch failed."), {
    code: "upstream_fetch_failed",
    status: 502,
    cause: source,
    details: { upstream: {
      layer,
      kind: cause.code === "ENOTFOUND"
        ? "DNS"
        : cause.code === "ECONNRESET"
          ? "ECONNRESET"
          : "TIMEOUT",
      code: cause.code,
      errno: cause.errno ?? null,
      syscall: cause.syscall ?? null,
      hostname: cause.hostname ?? null,
      address: cause.address ?? null,
      port: cause.port ?? null,
    } },
  });
}

test("native DNS fetch failure preserves safe cause and maps to diagnostic 502", () => {
  const mapped = mappedFetchFailure({
    code: "ENOTFOUND",
    errno: -3008,
    syscall: "getaddrinfo",
    hostname: "sellingpartnerapi-eu.amazon.com",
  }, "SP_API");
  const safe = safeSingleSkuDiagnosticError(mapped);
  assert.equal(safe.httpStatus, 502);
  assert.equal(safe.code, "upstream_fetch_failed");
  assert.equal(safe.failureLayer, "SP_API");
  assert.equal(safe.network.kind, "DNS");
  assert.equal(safe.network.code, "ENOTFOUND");
  assert.equal(safe.network.syscall, "getaddrinfo");
  assert.doesNotMatch(JSON.stringify(safe), /private|token|secret/i);
});

test("ECONNRESET and timeout-like failures are classified without leaking input", () => {
  const reset = safeSingleSkuDiagnosticError(mappedFetchFailure(
    { code: "ECONNRESET", address: "203.0.113.1", port: 443, authorization: "secret" }, "SP_API",
  ));
  const timeout = safeSingleSkuDiagnosticError(mappedFetchFailure(
    { code: "UND_ERR_CONNECT_TIMEOUT", client_secret: "secret" }, "LWA",
  ));
  assert.equal(reset.network.kind, "ECONNRESET");
  assert.equal(reset.network.address, "203.0.113.1");
  assert.equal(reset.network.port, 443);
  assert.equal(timeout.network.kind, "TIMEOUT");
  assert.equal(timeout.failureLayer, "LWA");
  assert.doesNotMatch(JSON.stringify({ reset, timeout }), /authorization|client_secret|secret/i);
});

test("route statically injects the canonical client into the pure diagnostic", async () => {
  const diagnostic = await readFile(new URL("./fbaInventorySingleSkuDiagnostic.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../../app/api/diagnostics/sp-api/inventory-summary/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(diagnostic, /import\("\.\/spApiClient"\)/);
  assert.match(route, /import \{ spApiRequest \} from "@\/modules\/amazon-sp-api\/spApiClient"/);
  assert.match(route, /request: spApiRequest/);
});
