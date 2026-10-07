import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { fbmManualEnabled, fbmRecoveryEnabled } from "../modules/amazon-sp-api/fbmSyncPolicy.ts";
import { handleDailyFbmGeneration } from "../modules/amazon-sp-api/fbmDailyGeneration.ts";
import { ledgerEnabled, ledgerScheduleEnabled } from "../modules/amazon-sp-api/fbaLedgerSyncPolicy.ts";

function load(file, dependencies) {
  const loaded = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", js)(name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, loaded, loaded.exports);
  return loaded.exports;
}
async function withEnvironment(value, run) {
  const keys = ["AMAZON_REPORT_SCHEDULER_ENABLED", "CRON_SECRET", "AMAZON_ORDERS_CANONICAL_ENABLED"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    delete process.env.AMAZON_REPORT_SCHEDULER_ENABLED;
    delete process.env.AMAZON_ORDERS_CANONICAL_ENABLED;
    if (value !== undefined) process.env.AMAZON_REPORT_SCHEDULER_ENABLED = value;
    process.env.CRON_SECRET = "offline-test-secret";
    await run();
  } finally {
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
}
test("Vercel schedules zero crons and keeps the four former routes", () => {
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
  assert.deepEqual(config.crons, []);
  for (const path of ["amazon/fbm-inventory-snapshot/generate", "amazon/reports/run",
    "amazon-financial-planning", "amazon-sp-api/reports/fba-sales/import"])
    assert.ok(fs.existsSync(`app/api/cron/${path}/route.ts`));
});
for (const value of [undefined, "", "false", "true", "TRUE", " true ", "1"]) {
  test(`actual legacy route: flag ${JSON.stringify(value)} => ${value === "true" ? "ON" : "OFF"}`, async () => {
    await withEnvironment(value, async () => {
      const calls = { scheduler: 0, sales: 0, ledger: 0, fbm: 0 };
      const route = load("app/api/cron/amazon/reports/run/route.ts", {
        "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
        "@/modules/amazon-sp-api/errors": { mapGenericError: error => ({ message: error.message }) },
        "@/modules/amazon-sp-api/amazonReportSchedulerService": { runSafeAmazonReportScheduler: async () => { calls.scheduler++; return {}; } },
        "@/modules/amazon-sp-api/fbaSalesSyncCoordinator": { resumeDueFbaSalesSync: async () => { calls.sales++; return null; } },
        "@/modules/amazon-sp-api/fbaLedgerSyncRecovery": { recoverPendingLedgerSync: async () => { calls.ledger++; return { status: "DISABLED" }; } },
        "@/modules/amazon-sp-api/fbmSyncRecovery": { recoverPendingFbmSync: async () => { calls.fbm++; return null; } },
      });
      const response = await route.GET({ headers: new Headers({ authorization: "Bearer offline-test-secret" }) });
      assert.equal(response.body.enabled, value === "true");
      assert.equal(calls.scheduler, value === "true" ? 1 : 0);
      assert.equal(calls.sales, value === "true" ? 1 : 0);
      // Existing independently gated recovery call path is deliberately unchanged.
      assert.equal(calls.ledger, 1);
      assert.equal(calls.fbm, 1);
      const unauthorized = await route.GET({ headers: new Headers() });
      assert.equal(unauthorized.status, 401);
      assert.equal(calls.ledger, 1);
    });
  });
}
test("Orders actual runtime defaults OFF before touching any dependency", async () => {
  await withEnvironment(undefined, async () => {
    const forbidden = new Proxy({}, { get: () => { throw new Error("Unexpected runtime access"); } });
    const runtime = load("modules/amazon-sp-api/allOrdersSalesSyncService.ts", {
      "./config": { DEFAULT_EU_MARKETPLACE_IDS: [] }, "./reportsClient": forbidden,
      "./allOrdersReportParser": {}, "./allOrdersDocument": {}, "./operationalAmazonIdentityRepository": {},
      "./allOrdersSyncPolicy": {}, "./allOrdersSyncCoordinator": {}, "./allOrdersSyncRepository": {},
    });
    await assert.rejects(runtime.resumeAllOrdersSync("offline-job"), /ALL_ORDERS_CANONICAL_DISABLED/);
    await assert.rejects(runtime.startAllOrdersSync({}), /ALL_ORDERS_CANONICAL_DISABLED/);
  });
});
test("FBM production manual/recovery default OFF; development remains available", () => {
  assert.equal(fbmManualEnabled({ NODE_ENV: "production" }), false);
  assert.equal(fbmRecoveryEnabled({ NODE_ENV: "production" }), false);
  assert.equal(fbmManualEnabled({ NODE_ENV: "development" }), true);
  assert.equal(fbmRecoveryEnabled({ NODE_ENV: "production", AMAZON_FBM_MANUAL_SYNC_ENABLED: "false", AMAZON_FBM_REPORTS_SYNC_ENABLED: "false" }), false);
});
test("FBM generation default OFF makes zero calls", async () => {
  let calls = 0;
  const response = await handleDailyFbmGeneration(new Request("https://offline.invalid", {
    headers: { authorization: "Bearer offline-test-secret" },
  }), async () => { calls++; throw new Error("Unexpected generation"); }, { CRON_SECRET: "offline-test-secret" });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).status, "DISABLED");
  assert.equal(calls, 0);
});
test("Ledger generation/recovery gates remain OFF by default", () => {
  assert.equal(ledgerEnabled({}), false);
  assert.equal(ledgerScheduleEnabled({}), false);
});
