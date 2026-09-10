import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ALAIA_FBM_SELLER_SKU,
  AMAZON_ES_MARKETPLACE_ID,
  getAlaiaEsFbmListingsItem,
} from "./listingsItemsClient.ts";

const config = () => ({
  region: "EU",
  endpoint: "https://sellingpartnerapi-eu.amazon.com",
  lwaClientId: "test",
  lwaClientSecret: "test",
  lwaRefreshToken: "test",
  sellerId: "seller-from-owner",
  marketplaceIds: [AMAZON_ES_MARKETPLACE_ID],
  useAwsSigV4: false,
});

async function run(raw, capture = {}) {
  return getAlaiaEsFbmListingsItem({
    loadConfig: config,
    request: async (input) => {
      capture.calls = (capture.calls ?? 0) + 1;
      capture.input = input;
      input.onResponseMetadata?.({
        operation: input.operation,
        status: 200,
        observedRateLimit: "5",
        retryAfter: null,
        requestId: "request-id",
        observedAt: "2026-09-01T10:00:00.000Z",
      });
      return raw;
    },
  });
}

test("DEFAULT 25 normalizes to 25", async () => {
  assert.equal((await run({ sku: ALAIA_FBM_SELLER_SKU, summaries: [{ asin: "B0DJBQGKBT" }], fulfillmentAvailability: [{ fulfillmentChannelCode: "DEFAULT", quantity: 25 }] })).mfnQuantity, 25);
});

test("DEFAULT 0 remains zero", async () => {
  assert.equal((await run({ fulfillmentAvailability: [{ fulfillmentChannelCode: "DEFAULT", quantity: 0 }] })).mfnQuantity, 0);
});

test("no DEFAULT is null", async () => {
  assert.equal((await run({ fulfillmentAvailability: [{ fulfillmentChannelCode: "AMAZON_EU", quantity: 12 }] })).mfnQuantity, null);
});

test("present empty fulfillmentAvailability is a valid completed non-FBM capture", async () => {
  const result = await run({ fulfillmentAvailability: [] });
  assert.deepEqual(result.fulfillmentAvailability, []);
  assert.equal(result.mfnQuantity, null);
});

test("invalid 2xx payloads fail with explicit semantic errors", async () => {
  await assert.rejects(() => run({ asin: "WRONG", fulfillmentAvailability: [] }), /FBM_LISTINGS_ASIN_INVALID/);
  await assert.rejects(() => run({ summaries: [{ asin: "WRONG" }], fulfillmentAvailability: [] }), /FBM_LISTINGS_ASIN_INVALID/);
  await assert.rejects(() => run({ fulfillmentAvailability: {} }), /FBM_LISTINGS_AVAILABILITY_INVALID/);
  await assert.rejects(() => run({ fulfillmentAvailability: [{ fulfillmentChannelCode: "DEFAULT", quantity: -1 }] }), /FBM_LISTINGS_QUANTITY_INVALID/);
  await assert.rejects(() => run({ fulfillmentAvailability: [{ fulfillmentChannelCode: "DEFAULT", quantity: "2" }] }), /FBM_LISTINGS_QUANTITY_INVALID/);
  await assert.rejects(() => run({ sku: "another-sku", fulfillmentAvailability: [] }), /FBM_LISTINGS_PAYLOAD_INVALID/);
});

test("Amazon Listings Items summaries carries ASIN when root ASIN is omitted", async () => {
  const result = await run({ sku: "f8436616610104", summaries: [{ asin: "B0DJBQGKBT" }], fulfillmentAvailability: [{ fulfillmentChannelCode: "AMAZON_EU" }] });
  assert.equal(result.asin, "B0DJBQGKBT");
  assert.equal(result.mfnQuantity, null);
});

test("issues are preserved in the diagnostic payload", async () => {
  const result = await run({ issues: [{ code: "TEST_ISSUE" }], fulfillmentAvailability: [] });
  assert.deepEqual(result.raw.issues, [{ code: "TEST_ISSUE" }]);
});

test("fixed raw SKU, ES marketplace, owner sellerId and one-shot request contract", async () => {
  const capture = {};
  const result = await run({ summaries: [{ asin: "B0DJBQGKBT", marketplaceId: AMAZON_ES_MARKETPLACE_ID }], fulfillmentAvailability: [] }, capture);
  assert.equal(capture.calls, 1);
  assert.equal(result.sellerSku, ALAIA_FBM_SELLER_SKU);
  assert.equal(result.marketplaceId, AMAZON_ES_MARKETPLACE_ID);
  assert.equal(result.asin, "B0DJBQGKBT");
  assert.equal(capture.input.path, "/listings/2021-08-01/items/seller-from-owner/f8436616610104");
  assert.deepEqual(capture.input.query, {
    marketplaceIds: "A1RKKUPIHCS9HS",
    includedData: "fulfillmentAvailability,summaries",
  });
  assert.equal(capture.input.rateLimitRetry.maxRetries, 0);
  assert.equal(capture.input.retryExpiredAccessToken, false);
  assert.equal(result.amazonHttpCalls, 1);
});

test("missing sellerId stops before request", async () => {
  let calls = 0;
  await assert.rejects(() => getAlaiaEsFbmListingsItem({
    loadConfig: () => ({ ...config(), sellerId: undefined }),
    request: async () => { calls += 1; return {}; },
  }), /AMAZON_SELLER_ID_MISSING/);
  assert.equal(calls, 0);
});

test("route and client have no persistence or write integration", async () => {
  const client = await readFile(new URL("./listingsItemsClient.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../../app/api/diagnostics/sp-api/listings-item-fbm/route.ts", import.meta.url), "utf8");
  const source = `${client}\n${route}`;
  assert.doesNotMatch(source, /supabase|repository|persist|snapshot|inventario_paises|InventoryPage|Planner|Forecast|Finance|producto_costos|\bPATCH\b|\bPOST\b|\bPUT\b|\bDELETE\b|Feeds/i);
  assert.match(client, /loadSpApiConfig/);
  assert.match(client, /spApiClient\.ts/);
  assert.match(route, /request: spApiRequest/);
});
