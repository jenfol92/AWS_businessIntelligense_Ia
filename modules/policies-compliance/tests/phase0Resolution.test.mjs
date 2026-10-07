import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

function load(source, mocks, env = { AMAZON_SELLER_ID: "seller" }) {
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const testModule = { exports: {} };
  new Function("require", "module", "exports", "process", "setTimeout", js)(
    (name) => { if (!(name in mocks)) throw new Error(`Unmocked dependency: ${name}`); return mocks[name]; },
    testModule, testModule.exports, { env }, (callback) => callback(),
  );
  return testModule.exports;
}
const serviceSource = await readFile(new URL("../services/policyComplianceService.ts", import.meta.url), "utf8");
const repositorySource = await readFile(new URL("../repositories/policyAlertsRepository.ts", import.meta.url), "utf8");
const alert = { id: "alert", sku: "seller-sku", marketplace_id: "MARKETDE", category: "LISTING", type: "90220", still_in_amazon: true };

async function sync(observation) {
  const updates = [];
  const service = load(serviceSource, {
    "@/modules/amazon-sp-api/listingsItemsClient": { getListingIssues: async (input) => {
      assert.equal(input.sellerSku, alert.sku);
      assert.equal(input.marketplaceId, alert.marketplace_id);
      return observation;
    } },
    "../repositories/policyAlertsRepository": {
      listActivePolicyAlerts: async () => [alert],
      updateAlertSyncState: async (...args) => updates.push(args),
    },
    "./catalogItemsClient": {}, "../utils/mapNotificationToAlert": {}, "../utils/policyAlertGrouping": {},
  });
  return { result: await service.syncWithAmazon(), updates };
}

for (const status of ["LISTING_NOT_FOUND", "RATE_LIMITED", "UNAUTHORIZED", "QUERY_FAILED", "INVALID_RESPONSE", "UNKNOWN"]) {
  test(`${status}: no resolution and no verification timestamp write`, async () => {
    const { result, updates } = await sync({ status, checkedAt: "attempt-time" });
    assert.equal(result.resolved, 0);
    assert.equal(result.checked, 0);
    assert.equal(result.errors, 1);
    assert.deepEqual(updates, []);
  });
}

test("explicit zero issues does not resolve an unvalidated legacy alert", async () => {
  const { result, updates } = await sync({ status: "SUCCESS", issues: [], checkedAt: "success-time" });
  assert.equal(result.checked, 1);
  assert.equal(result.unconfirmed, 1);
  assert.equal(result.resolved, 0);
  assert.deepEqual(updates, []);
});

test("different issue code does not resolve an unvalidated legacy alert", async () => {
  const { updates } = await sync({ status: "SUCCESS", issues: [{ code: "other", categories: ["LISTING"] }] });
  assert.deepEqual(updates, []);
});

test("only successful positive evidence refreshes the existing verification timestamp", async () => {
  const { updates, result } = await sync({ status: "SUCCESS", checkedAt: "success-time",
    issues: [{ code: "90220", categories: ["LISTING"], severity: "ERROR" }] });
  assert.equal(result.checked, 1);
  assert.equal(result.resolved, 0);
  assert.deepEqual(updates, [["alert", { stillInAmazon: true, checkedAt: "success-time" }]]);
});

test("repository blocks manual and automatic negative updates before any DB call", async () => {
  const repository = load(repositorySource, { "@/server/supabase/adminClient": {
    supabaseAdmin: { from() { assert.fail("unexpected database call"); } },
  } });
  await assert.rejects(() => repository.markAlertResolvedInternally("alert"), /REQUIRES_AMAZON_EVIDENCE/);
  await assert.rejects(() => repository.updateAlertSyncState("alert", { stillInAmazon: false, checkedAt: "now" }), /DISABLED_PHASE_0/);
});

test("unvalidated compliance transport and parallel Listings request are removed", () => {
  assert.doesNotMatch(serviceSource, /fetchComplianceAlerts|importComplianceAlerts|productComplianceAttributes|GetProductComplianceAttributes|spApiRequest|A1RKKUPIHCS9HS/);
});

const routeSource = await readFile(new URL("../../../app/api/diagnostics/sp-api/listing-issues/route.ts", import.meta.url), "utf8");

function route(env, session, diagnose = async () => ({ ok: true, amazonObservation: { status: "SUCCESS", issues: [] } })) {
  return load(routeSource, {
    "next/server": { NextResponse: { json: (body, options) => ({ body, ...options }) } },
    "@/server/supabase/routeClient": { createSupabaseRouteClient: () => {
      assert.notEqual(env.NODE_ENV, "production");
      return { auth: { getSession: async () => ({ data: { session } }) } };
    } },
    "@/modules/products/repositories/productMarketplacesRepository": { findProductMarketplaces() {} },
    "@/modules/amazon-sp-api/listingIssuesDiagnostic": { diagnoseProductListingIssues: diagnose },
  }, env);
}

test("diagnostic route blocks production before reads or Amazon calls", async () => {
  const response = await route({ NODE_ENV: "production" }, null).GET({});
  assert.equal(response.status, 404);
});
test("diagnostic route requires the existing session boundary", async () => {
  assert.equal((await route({ NODE_ENV: "development" }, null).GET({})).status, 401);
});
test("diagnostic returns no-store and never exposes thrown upstream secrets", async () => {
  const request = { nextUrl: new URL("http://localhost/api?productoId=p&marketplaceId=m") };
  const response = await route({ NODE_ENV: "development" }, {}, async () => { throw new Error("secret"); }).GET(request);
  assert.equal(response.status, 500);
  assert.equal(response.headers["Cache-Control"], "no-store");
  assert.doesNotMatch(JSON.stringify(response), /secret/);
});
