import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SpApiError } from "./errors.ts";
import {
  attachSpApiRequestContext,
  buildInboundSpApiFailureLog,
  buildInboundSyncFailureResponse,
  inferInboundApiFromPath,
  pickSafeRateLimitHeaders,
} from "./inboundSyncErrorInstrumentation.ts";

function rateLimitedError(overrides = {}) {
  return new SpApiError("QuotaExceeded", "rate_limited", 429, {
    errors: [{ code: "QuotaExceeded", message: "You exceeded your quota" }],
    headers: {
      "retry-after": "2",
      "x-amzn-ratelimit-limit": "2.0",
      "x-amzn-ratelimit-remaining": "0",
      authorization: "Bearer SECRET",
      "x-amz-access-token": "ATZA.secret",
    },
    requestId: "req-123",
    operation: "GET /inbound/fba/2024-03-20/inboundPlans",
    method: "GET",
    path: "/inbound/fba/2024-03-20/inboundPlans",
    ...overrides,
  });
}

test("inferInboundApiFromPath distingue v2024 y v0", () => {
  assert.strictEqual(
    inferInboundApiFromPath("/inbound/fba/2024-03-20/inboundPlans"),
    "fulfillment-inbound-v2024-03-20",
  );
  assert.strictEqual(
    inferInboundApiFromPath("/fba/inbound/v0/shipments"),
    "fulfillment-inbound-v0",
  );
  assert.strictEqual(inferInboundApiFromPath("/reports/2021-06-30/reports"), null);
});

test("pickSafeRateLimitHeaders omite authorization y tokens", () => {
  const picked = pickSafeRateLimitHeaders({
    "retry-after": "1",
    "x-amzn-ratelimit-limit": "0.5",
    authorization: "Bearer SECRET",
    "x-amz-access-token": "ATZA.secret",
    cookie: "session=1",
  });
  assert.deepStrictEqual(picked, {
    "retry-after": "1",
    "x-amzn-ratelimit-limit": "0.5",
  });
  assert.ok(!JSON.stringify(picked).includes("SECRET"));
  assert.ok(!JSON.stringify(picked).includes("ATZA"));
});

test("buildInboundSpApiFailureLog captura origen 429 sin secretos", () => {
  const log = buildInboundSpApiFailureLog(rateLimitedError());
  assert.strictEqual(log.api, "fulfillment-inbound-v2024-03-20");
  assert.strictEqual(log.operation, "GET /inbound/fba/2024-03-20/inboundPlans");
  assert.strictEqual(log.httpStatus, 429);
  assert.strictEqual(log.amazonCode, "QuotaExceeded");
  assert.strictEqual(log.amazonMessage, "You exceeded your quota");
  assert.strictEqual(log.requestId, "req-123");
  assert.strictEqual(log.retryAfter, "2");
  assert.strictEqual(log.rateLimitHeaders["x-amzn-ratelimit-limit"], "2.0");
  const serialized = JSON.stringify(log);
  assert.doesNotMatch(serialized, /Bearer SECRET|ATZA\.secret|authorization/i);
});

test("429 JSON incluye campos disponibles y omite los vacíos", () => {
  const { status, body } = buildInboundSyncFailureResponse(rateLimitedError());
  assert.strictEqual(status, 429);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(body.status, 429);
  assert.strictEqual(body.api, "fulfillment-inbound-v2024-03-20");
  assert.strictEqual(body.operation, "GET /inbound/fba/2024-03-20/inboundPlans");
  assert.strictEqual(body.amazonCode, "QuotaExceeded");
  assert.strictEqual(body.requestId, "req-123");
  assert.strictEqual(body.retryAfter, "2");
  assert.ok(!("rateLimitHeaders" in body));
  assert.doesNotMatch(JSON.stringify(body), /Bearer SECRET|ATZA\.secret/i);

  const sparse = buildInboundSyncFailureResponse(
    new SpApiError("Rate limit SP-API.", "rate_limited", 429, {}),
  );
  assert.strictEqual(sparse.body.status, 429);
  assert.ok(!("api" in sparse.body));
  assert.ok(!("operation" in sparse.body));
  assert.ok(!("amazonCode" in sparse.body));
  assert.ok(!("requestId" in sparse.body));
  assert.ok(!("retryAfter" in sparse.body));
});

test("non-429 no añade campos de diagnóstico 429", () => {
  const { status, body } = buildInboundSyncFailureResponse(
    new SpApiError("boom", "unknown", 500, {
      path: "/inbound/fba/2024-03-20/inboundPlans",
      requestId: "req-500",
    }),
  );
  assert.strictEqual(status, 500);
  assert.ok(!("status" in body));
  assert.ok(!("api" in body));
  assert.ok(!("requestId" in body));
});

test("attachSpApiRequestContext guarda path sin query", () => {
  const attached = attachSpApiRequestContext(
    new SpApiError("QuotaExceeded", "rate_limited", 429, { headers: {} }),
    {
      url: "https://sellingpartnerapi-eu.amazon.com/inbound/fba/2024-03-20/inboundPlans?pageSize=30&paginationToken=SECRET",
      method: "GET",
      operation: "GET /inbound/fba/2024-03-20/inboundPlans",
    },
  );
  const details = attached.details;
  assert.strictEqual(details.path, "/inbound/fba/2024-03-20/inboundPlans");
  assert.doesNotMatch(JSON.stringify(details), /paginationToken=SECRET/);
});

test("sync route loguea fallos SP-API y expone JSON 429 seguro", async () => {
  const source = await readFile("app/api/amazon/inbound-shipments/sync/route.ts", "utf8");
  assert.match(source, /logInboundSpApiFailure/);
  assert.match(source, /buildInboundSyncFailureResponse/);
  assert.doesNotMatch(source, /accessToken|refresh_token|client_secret|Authorization/i);
});
