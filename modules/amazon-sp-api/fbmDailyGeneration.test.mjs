import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDailyFbmSync, handleDailyFbmGeneration } from './fbmDailyGeneration.ts';
import { initialFbmState } from './fbmSyncPolicy.ts';
import fs from 'node:fs';

globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
const now = Date.parse('2026-10-08T04:05:00Z');
const job = (status, day = '2026-10-07') => ({ id: 'existing', state: { ...initialFbmState(), status,
  createIntentAt: day + 'T01:00:00Z', completedAt: day + 'T02:00:00Z' } });
for (const status of ['PENDING', 'PROCESSING', 'RATE_LIMITED', 'FAILED', 'FATAL', 'CANCELLED', 'CREATE_UNCERTAIN']) {
  test('daily generator never replaces or advances ' + status, async () => {
    const r = await generateDailyFbmSync({ now: () => now, latest: async () => job(status), start: async () => { throw new Error('MUST_NOT_START'); } });
    assert.equal(r.status, status);
  });
}
test('completed generation from today is not regenerated even after five minutes', async () => {
  assert.equal((await generateDailyFbmSync({ now: () => now, latest: async () => job('COMPLETED', '2026-10-08'), start: async () => { throw new Error('MUST_NOT_START'); } })).status, 'COMPLETED');
});
test('old completion and empty database permit one supported start', async () => {
  for (const latest of [null, job('COMPLETED')]) {
    let starts = 0;
    await generateDailyFbmSync({ now: () => now, latest: async () => latest, start: async () => { starts++; return { status: 'PENDING' }; } });
    assert.equal(starts, 1);
  }
});
test('recent publication of an old report respects technical refresh cooldown', async () => {
  const recent = job('COMPLETED'); recent.state.completedAt = new Date(now - 1000).toISOString();
  await generateDailyFbmSync({ now: () => now, latest: async () => recent, start: async () => { throw new Error('MUST_NOT_START'); } });
});
test('malformed completion/creation metadata cannot authorize another generation', async () => {
  for (const field of ['completedAt', 'createIntentAt']) {
    const broken = job('COMPLETED'); broken.state[field] = 'invalid';
    await generateDailyFbmSync({ now: () => now, latest: async () => broken, start: async () => { throw new Error('MUST_NOT_START'); } });
  }
});
test('dedicated GET cron requires secret and generation opt-in', async () => {
  const env = { CRON_SECRET: 'test-secret', AMAZON_FBM_REPORTS_SYNC_ENABLED: 'true' };
  let starts = 0; const run = async () => { starts++; return null; };
  const request = token => new Request('https://example.test/fbm', { headers: { authorization: token } });
  assert.equal((await handleDailyFbmGeneration(request('wrong'), run, env)).status, 401);
  assert.equal((await handleDailyFbmGeneration(request('Bearer test-secret'), run, { ...env, AMAZON_FBM_REPORTS_SYNC_ENABLED: 'false' })).status, 503);
  assert.equal(starts, 0);
  assert.equal((await handleDailyFbmGeneration(request('Bearer test-secret'), run, env)).status, 200); assert.equal(starts, 1);
});
test('repeated automatic generation ticks after completion cannot request another report today', async () => {
  let latest = null, starts = 0;
  const deps = { now: () => now, latest: async () => latest, start: async () => {
    starts++; latest = job('PENDING', '2026-10-08'); return { status: 'PENDING', jobId: latest.id };
  } };
  await generateDailyFbmSync(deps);
  latest.state.status = 'COMPLETED';
  for (let i = 0; i < 5; i++) await generateDailyFbmSync(deps);
  assert.equal(starts, 1);
});
test('dedicated new call graph does not invoke shared schedulers or FBA owners', () => {
  const files = ['modules/amazon-sp-api/fbmDailyGeneration.ts', 'modules/amazon-sp-api/fbmIdentityReconciliation.ts',
    'app/api/cron/amazon/fbm-inventory-snapshot/generate/route.ts', 'scripts/run-fbm-worker.mjs'];
  for (const file of files) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /fbaLedger|fbaSales|InventorySummaries|inventario_paises|amazonReportScheduler|\/api\/cron\/amazon\/reports\/run/);
});
