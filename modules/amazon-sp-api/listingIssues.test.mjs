import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import * as errors from "./errors.ts";
import * as retryPolicy from "./spApiRetryPolicy.ts";
import { getListingIssues } from "./listingsItemsClient.ts";

const config = () => ({ sellerId: "seller", region: "EU", endpoint: "https://example.invalid",
  marketplaceIds: [], lwaClientId: "test", lwaClientSecret: "test", lwaRefreshToken: "test", useAwsSigV4: false });
const issue = { code: "90220", message: "Attribute required", severity: "ERROR", categories: ["MISSING_ATTRIBUTE", "LISTING"],
  attributeNames: ["size"], marketplaceIds: ["MARKETDE"],
  enforcements: { actions: [{ action: "LISTING_SUPPRESSED" }], exemption: { status: "NOT_EXEMPT" } } };
const run = (raw, extra = {}) => getListingIssues({ sellerSku: "exact SKU/+", marketplaceId: "MARKETDE",
  loadConfig: config, request: async () => raw, ...extra });

test("valid issues preserve documented fields, order and enforcement; unrelated raw fields excluded", async () => {
  const result = await run({ sku: "exact SKU/+", issues: [{ ...issue, arbitrary: "not returned" }], attributes: { unwanted: true } });
  assert.equal(result.status, "SUCCESS");
  assert.deepEqual(result.issues, [issue]);
  assert.equal("raw" in result, false);
});

test("explicit empty ItemIssues on the requested Item is SUCCESS, not legal compliance", async () => {
  const result = await run({ sku: "exact SKU/+", issues: [] });
  assert.equal(result.status, "SUCCESS");
  assert.deepEqual(result.issues, []);
  assert.equal("compliant" in result, false);
});

for (const [name, raw] of Object.entries({
  omitted: { sku: "exact SKU/+" }, null: null, array: [], text: "unexpected",
  issuesNull: { sku: "exact SKU/+", issues: null }, wrongSku: { sku: "another", issues: [] },
  missingSku: { issues: [] }, malformedIssue: { sku: "exact SKU/+", issues: [{ code: "90220" }] },
  severityArray: { sku: "exact SKU/+", issues: [{ ...issue, severity: ["ERROR"] }] },
  wrongMarketplace: { sku: "exact SKU/+", issues: [{ ...issue, marketplaceIds: ["OTHER"] }] },
  malformedEnforcement: { sku: "exact SKU/+", issues: [{ ...issue, enforcements: { actions: [] } }] },
  partial: { sku: "exact SKU/+", issues: [], errors: [{ message: "partial" }] },
})) test(`invalid response: ${name}`, async () => {
  const result = await run(raw);
  assert.equal(result.status, "INVALID_RESPONSE");
  assert.equal("issues" in result, false);
});

for (const [httpStatus, expected] of [[404, "LISTING_NOT_FOUND"], [429, "RATE_LIMITED"], [401, "UNAUTHORIZED"],
  [403, "UNAUTHORIZED"], [500, "QUERY_FAILED"], [503, "QUERY_FAILED"], [undefined, "QUERY_FAILED"]]) {
  test(`upstream ${httpStatus ?? "network"} stays a typed failure and redacts details`, async () => {
    const result = await run(null, { request: async () => {
      throw Object.assign(new Error("secret raw message"), { status: httpStatus, details: { authorization: "secret" } });
    } });
    assert.equal(result.status, expected);
    assert.equal("issues" in result, false);
    assert.doesNotMatch(JSON.stringify(result), /secret|authorization/);
  });
}

test("aborted timeout maps to QUERY_FAILED", async () => {
  const signal = AbortSignal.abort(new DOMException("timeout", "TimeoutError"));
  const result = await run(null, { signal, request: async (input) => { input.signal.throwIfAborted(); } });
  assert.equal(result.status, "QUERY_FAILED");
});

test("uses shared transport parameters, configured seller, exact encoded SKU and response telemetry", async () => {
  const signal = new AbortController().signal;
  const result = await run(null, { signal, request: async (input) => {
    assert.equal(input.method, "GET");
    assert.equal(input.path, "/listings/2021-08-01/items/seller/exact%20SKU%2F%2B");
    assert.deepEqual(input.query, { marketplaceIds: "MARKETDE", includedData: "issues" });
    assert.equal(input.rateLimitRetry.maxRetries, 1);
    assert.equal(input.signal, signal);
    input.onResponseMetadata({ requestId: "request-1" });
    return { sku: "exact SKU/+", issues: [] };
  } });
  assert.equal(result.requestId, "request-1");
  assert.equal(result.sellerId, "seller");
});

test("diagnostic oneShot disables both shared-client replay paths", async () => {
  await run(null, { oneShot: true, request: async (input) => {
    assert.equal(input.rateLimitRetry.maxRetries, 0);
    assert.equal(input.retryExpiredAccessToken, false);
    return { sku: "exact SKU/+", issues: [] };
  } });
});

test("missing identity/configuration cannot call Amazon", async () => {
  const request = async () => { assert.fail("unexpected Amazon request"); };
  assert.equal((await run(null, { sellerSku: "", request })).status, "UNKNOWN");
  assert.equal((await run(null, { loadConfig: () => ({ ...config(), sellerId: undefined }), request })).status, "UNKNOWN");
  assert.equal((await run(null, { loadConfig: () => { throw new Error("secret"); }, request })).error, "SP_API_CONFIGURATION_UNAVAILABLE");
});

test("actual shared transport exhausts its bounded 429 retry and returns RATE_LIMITED", async () => {
  const source = await readFile(new URL("./spApiClient.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  let calls = 0;
  const delays = [];
  const mocks = {
    "./config": { loadSpApiConfig: config, isAwsSigV4Configured: () => false },
    "./errors": errors,
    "./inboundSyncErrorInstrumentation": { attachSpApiRequestContext: (error) => error },
    "./lwaClient": { getLwaAccessToken: async () => ({ accessToken: "test-only", expiresIn: 600 }) },
    "./signing": {}, "./spApiRetryPolicy": retryPolicy,
  };
  const testModule = { exports: {} };
  new Function("require", "module", "exports", "fetch", "setTimeout", js)(
    (name) => { if (!(name in mocks)) throw new Error(`Unmocked: ${name}`); return mocks[name]; },
    testModule, testModule.exports,
    async () => {
      calls++;
      return new Response(JSON.stringify({ errors: [{ code: "QuotaExceeded", message: "bounded test" }] }), {
        status: 429, headers: { "retry-after": "1", "x-amzn-requestid": `req-${calls}` },
      });
    },
    (callback, delay) => { delays.push(delay); callback(); },
  );
  const result = await run(null, { request: testModule.exports.spApiRequest });
  assert.equal(result.status, "RATE_LIMITED");
  assert.equal(calls, 2);
  assert.equal(result.amazonResponses, 2);
  assert.equal(result.requestId, "req-2");
  assert.deepEqual(delays, [1000]);
});
