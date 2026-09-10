import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { invokeLocalFbmReportsSync } from "../../scripts/run-fbm-reports-sync.mjs";

// Test-only resolution of this repo's extensionless TypeScript imports.
const root = new URL("./", import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (context.parentURL?.startsWith(root) && specifier.startsWith(".") && !path.extname(specifier)) {
    const target = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(target)) return nextResolve(target.href, context);
  }
  return nextResolve(specifier, context);
} });
let realCalls = 0;
const forbidden = async () => { realCalls++; throw new Error("REAL_FETCH_FORBIDDEN"); };
globalThis.fetch = forbidden;
test.after(() => { hooks.deregister(); assert.equal(realCalls, 0); });

test("canonical transport passes abort to LWA and Reports, no token-expiry replay", async () => {
  Object.assign(process.env, { AMAZON_SP_API_REGION: "EU", AMAZON_SP_API_ENDPOINT: "https://sellingpartnerapi-eu.amazon.com", AMAZON_SP_API_USE_AWS_SIGV4: "false", AMAZON_MARKETPLACE_ES: "A1RKKUPIHCS9HS", AMAZON_LWA_CLIENT_ID: "test-client", AMAZON_LWA_CLIENT_SECRET: "test-secret", AMAZON_LWA_REFRESH_TOKEN: "test-refresh" });
  const { spApiRequest } = await import("./spApiClient.ts");
  const { clearLwaAccessTokenCache } = await import("./lwaClient.ts");
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init }); assert.equal(init.redirect, "error"); assert.ok(init.signal);
    if (url === "https://api.amazon.com/auth/o2/token") return Response.json({ access_token: "MOCK_TOKEN", expires_in: 3600 });
    return Response.json({ errors: [{ code: "Unauthorized", message: "The access token you provided has expired" }] }, { status: 403 });
  };
  try {
    clearLwaAccessTokenCache();
    await assert.rejects(spApiRequest({ method: "POST", path: "/reports/2021-06-30/reports", signal: AbortSignal.timeout(1000), retryExpiredAccessToken: false, rateLimitRetry: { maxRetries: 0 } }));
    assert.equal(calls.length, 2); assert.equal(calls[1].init.headers["x-amz-access-token"], "MOCK_TOKEN");
    clearLwaAccessTokenCache(); calls.length = 0;
    globalThis.fetch = async (_url, init) => { calls.push(init); return new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("ABORTED_MOCK")), { once: true })); };
    const controller = new AbortController();
    const pending = spApiRequest({ method: "POST", path: "/reports/2021-06-30/reports", signal: controller.signal, retryExpiredAccessToken: false });
    controller.abort(); await assert.rejects(pending); assert.equal(calls.length, 1);
  } finally { globalThis.fetch = forbidden; clearLwaAccessTokenCache(); }
});

test("local manual command requires explicit flag and sends one authenticated POST, no retries", async () => {
  assert.equal((await invokeLocalFbmReportsSync([], forbidden)).status, "EXPLICIT_RUN_REQUIRED");
  process.env.CRON_SECRET = "test-cron-secret";
  let calls = 0;
  const r = await invokeLocalFbmReportsSync(["--run-once"], async (url, init) => {
    calls++; assert.equal(url, "http://localhost:3000/api/cron/amazon/fbm-inventory-snapshot");
    assert.equal(init.method, "POST"); assert.equal(init.headers.authorization, "Bearer test-cron-secret"); assert.equal(init.redirect, "error");
    return Response.json({ status: "SUCCESS", rowsCommitted: 3 });
  });
  assert.equal(calls, 1); assert.equal(r.status, "SUCCESS"); assert.doesNotMatch(JSON.stringify(r), /test-cron-secret/);
});

test("full production graph paginates identities and makes one atomic RPC with entirely mocked Amazon and Supabase", async () => {
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_URL: "https://fbm-unit-test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "mock-service-key", AMAZON_SP_API_REGION: "EU", AMAZON_SP_API_ENDPOINT: "https://sellingpartnerapi-eu.amazon.com", AMAZON_SP_API_USE_AWS_SIGV4: "false", AMAZON_MARKETPLACE_ES: "A1RKKUPIHCS9HS", AMAZON_LWA_CLIENT_ID: "test-client", AMAZON_LWA_CLIENT_SECRET: "test-secret", AMAZON_LWA_REFRESH_TOKEN: "test-refresh" });
  const { clearLwaAccessTokenCache } = await import("./lwaClient.ts");
  clearLwaAccessTokenCache();
  const products = Array.from({ length: 501 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`, sku: `TEST-${i}`, asin: "B0DJBQGKBT", estado: "activo" }));
  const reportText = "seller-sku\tquantity\tfulfillment-channel\n" + products.map(p => `${p.sku}\t0\tDEFAULT`).join("\n");
  const calls = { reads: 0, lwa: 0, reports: 0, downloads: 0, rpc: 0 };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.origin === "https://fbm-unit-test.supabase.co" && url.pathname === "/rest/v1/productos" && init.method === "GET") {
      calls.reads++;
      assert.equal(url.searchParams.get("estado"), "eq.activo"); assert.equal(url.searchParams.get("order"), "id.asc");
      assert.equal(url.searchParams.get("select"), "id,sku,asin,estado");
      const offset = Number(url.searchParams.get("offset")); const limit = Number(url.searchParams.get("limit"));
      assert.equal(limit, 500); return Response.json(products.slice(offset, offset + limit));
    }
    if (url.origin === "https://fbm-unit-test.supabase.co" && url.pathname === "/rest/v1/rpc/commit_amazon_fbm_inventory_snapshot_run" && init.method === "POST") {
      calls.rpc++;
      const args = JSON.parse(init.body);
      assert.equal(args.p_expected_identity_count, products.length); assert.equal(args.p_completed_identity_count, products.length);
      assert.equal(args.p_rows.length, products.length); assert.equal(args.p_capture_complete, true);
      assert.ok(args.p_rows.every(r => r.available_quantity === 0 && r.asin === null && r.marketplace_id === "A1RKKUPIHCS9HS"));
      return Response.json(products.length);
    }
    if (url.href === "https://api.amazon.com/auth/o2/token") { calls.lwa++; return Response.json({ access_token: "MOCK_TOKEN", expires_in: 3600 }); }
    if (url.origin === "https://sellingpartnerapi-eu.amazon.com") {
      calls.reports++;
      if (init.method === "POST" && url.pathname === "/reports/2021-06-30/reports") return Response.json({ reportId: "78910" }, { status: 202 });
      if (init.method === "GET" && url.pathname === "/reports/2021-06-30/reports/78910") return Response.json({ reportId: "78910", reportType: "GET_MERCHANT_LISTINGS_ALL_DATA", marketplaceIds: ["A1RKKUPIHCS9HS"], processingStatus: "DONE", reportDocumentId: "DOC-2", createdTime: new Date().toISOString() });
      if (init.method === "GET" && url.pathname === "/reports/2021-06-30/documents/DOC-2") return Response.json({ reportDocumentId: "DOC-2", url: "https://example.s3.amazonaws.com/mock" });
    }
    if (url.href === "https://example.s3.amazonaws.com/mock") { calls.downloads++; assert.equal(init.headers, undefined); return new Response(reportText); }
    throw new Error("UNEXPECTED_FETCH_REAL_NETWORK_FORBIDDEN");
  };
  try {
    const { syncAmazonFbmInventoryFromReports } = await import("./amazonFbmReportsSyncService.ts");
    const result = await syncAmazonFbmInventoryFromReports({ sleep: async () => {} });
    assert.equal(result.status, "SUCCESS", JSON.stringify(result)); assert.equal(result.rowsCommitted, products.length);
    assert.deepEqual(calls, { reads: 4, lwa: 1, reports: 3, downloads: 1, rpc: 1 });
  } finally { globalThis.fetch = forbidden; clearLwaAccessTokenCache(); }
});
