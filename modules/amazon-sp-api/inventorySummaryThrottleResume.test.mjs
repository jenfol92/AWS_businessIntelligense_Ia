import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function loadPolicy() {
  let source = await readFile("modules/amazon-sp-api/inventorySummaryFilteredRequest.ts", "utf8");
  source = source.replace(/^import .*?;\r?\n/gm, "").replace(/export /g, "");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("module", "exports", `${js}\nmodule.exports={requestInventorySummaryBatchWithThrottleResume,resolveInventorySummaryThrottleDelay,MAX_THROTTLE_RESUMES_PER_BATCH,MAX_WAIT_PER_INVENTORY_SUMMARY_429_MS};`)(module, module.exports);
  return module.exports;
}

const throttled = (retryAfter) => ({
  code: "rate_limited",
  status: 429,
  details: { headers: retryAfter == null ? {} : { "retry-after": retryAfter } },
});

test("3 ES + 2 GB OK y solo GB batch 3 reanuda tras Retry-After", async () => {
  const { requestInventorySummaryBatchWithThrottleResume } = await loadPolicy();
  const calls = new Map();
  const waits = [];
  const completed = [];
  for (const batch of ["ES1", "ES2", "ES3", "GB1", "GB2", "GB3"]) {
    const response = await requestInventorySummaryBatchWithThrottleResume({
      startedAtMs: 0,
      maxTotalDurationMs: 60_000,
      observedRateLimit: () => "2.0",
      now: () => 0,
      random: () => 0,
      wait: async (ms) => waits.push(ms),
      request: async () => {
        calls.set(batch, (calls.get(batch) ?? 0) + 1);
        if (batch === "GB3" && calls.get(batch) === 1) throw throttled("2");
        return { inventorySummaries: [{ batch }] };
      },
    });
    assert.equal(response.inventorySummaries[0].batch, batch);
    completed.push(batch);
  }
  assert.deepEqual(completed, ["ES1", "ES2", "ES3", "GB1", "GB2", "GB3"]);
  assert.deepEqual(Object.fromEntries(calls), { ES1: 1, ES2: 1, ES3: 1, GB1: 1, GB2: 1, GB3: 2 });
  assert.deepEqual(waits, [2_000]);
});

test("dos 429 agotan el único resume y dejan el pool incompleto sin publicación", async () => {
  const { requestInventorySummaryBatchWithThrottleResume, MAX_THROTTLE_RESUMES_PER_BATCH } = await loadPolicy();
  let calls = 0;
  let published = false;
  await assert.rejects(
    requestInventorySummaryBatchWithThrottleResume({
      startedAtMs: 0,
      maxTotalDurationMs: 60_000,
      observedRateLimit: () => "2.0",
      now: () => 0,
      random: () => 0,
      wait: async () => {},
      request: async () => { calls += 1; throw throttled("2"); },
    }).then(() => { published = true; }),
    (error) => error.code === "rate_limited",
  );
  assert.equal(MAX_THROTTLE_RESUMES_PER_BATCH, 1);
  assert.equal(calls, 2);
  assert.equal(published, false);
});

test("Retry-After tiene precedencia y se respeta sin espera real", async () => {
  const { resolveInventorySummaryThrottleDelay } = await loadPolicy();
  assert.deepEqual(resolveInventorySummaryThrottleDelay({
    errorDetails: { headers: { "retry-after": "2" } },
    observedRateLimit: "100",
    nowMs: 0,
    random: () => 0,
  }), { delayMs: 2_000, minimumDelayMs: 2_000, source: "retry-after" });
});

test("sin Retry-After usa cuatro intervalos conservadores del rate observado", async () => {
  const { resolveInventorySummaryThrottleDelay } = await loadPolicy();
  assert.deepEqual(resolveInventorySummaryThrottleDelay({
    errorDetails: { headers: {} },
    observedRateLimit: "2.0",
    nowMs: 0,
    random: () => 0,
  }), { delayMs: 2_000, minimumDelayMs: 2_000, source: "observed-rate-limit" });
});

test("401 y 403 no reanudan", async () => {
  const { requestInventorySummaryBatchWithThrottleResume } = await loadPolicy();
  for (const status of [401, 403]) {
    let calls = 0;
    let waits = 0;
    await assert.rejects(requestInventorySummaryBatchWithThrottleResume({
      startedAtMs: 0,
      maxTotalDurationMs: 60_000,
      observedRateLimit: () => "2.0",
      now: () => 0,
      wait: async () => { waits += 1; },
      request: async () => { calls += 1; throw { status, code: "access_denied" }; },
    }));
    assert.equal(calls, 1);
    assert.equal(waits, 0);
  }
});

test("no espera ni reanuda si excedería MAX_TOTAL_SYNC_DURATION", async () => {
  const { requestInventorySummaryBatchWithThrottleResume } = await loadPolicy();
  let waits = 0;
  await assert.rejects(requestInventorySummaryBatchWithThrottleResume({
    startedAtMs: 0,
    maxTotalDurationMs: 1_500,
    observedRateLimit: () => "2.0",
    now: () => 0,
    random: () => 0,
    wait: async () => { waits += 1; },
    request: async () => { throw throttled("2"); },
  }), /runtime budget exceeded/);
  assert.equal(waits, 0);
});

test("una espera Amazon superior al máximo operativo aborta limpia", async () => {
  const { requestInventorySummaryBatchWithThrottleResume, MAX_WAIT_PER_INVENTORY_SUMMARY_429_MS } = await loadPolicy();
  await assert.rejects(requestInventorySummaryBatchWithThrottleResume({
    startedAtMs: 0,
    maxTotalDurationMs: 15 * 60_000,
    observedRateLimit: () => "2.0",
    now: () => 0,
    random: () => 0,
    wait: async () => assert.fail("no debe esperar"),
    request: async () => { throw throttled("61"); },
  }), new RegExp(`WAIT_EXCEEDS_LIMIT:61000/${MAX_WAIT_PER_INVENTORY_SUMMARY_429_MS}`));
});

test("la publicación atómica sigue después de adquisición y reconciliación", async () => {
  const source = await readFile("modules/amazon-sp-api/fbaForecastSpApiImportsService.ts", "utf8");
  const owner = source.slice(source.indexOf("export async function importFbaInventorySnapshotFromSpApi"), source.indexOf("async function legacyFbaLedgerDailyFromSpApiDisabled"));
  const acquisition = owner.indexOf("result = await requestInventorySummaryBatchWithThrottleResume");
  const canonicalization = owner.indexOf("const canonical = buildCanonicalInventorySnapshot");
  const publication = owner.indexOf('"commit_amazon_fba_inventory_snapshot_run"');
  assert.ok(acquisition >= 0 && acquisition < canonicalization);
  assert.ok(canonicalization < publication);
  assert.match(owner, /if \(publicationSummary\.asinIdentityConflicts > 0\)/);
});
