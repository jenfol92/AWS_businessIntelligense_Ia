import test from 'node:test';
import assert from 'node:assert/strict';
import { runFbmWorkerTick, serveFbmWorker } from './run-fbm-worker.mjs';

globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
test('external ticks use only dedicated FBM routes; persisted server policy owns daily eligibility', async () => {
  const paths = [];
  const transport = async (url, init) => {
    paths.push(url.pathname); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    return Response.json({ status: 'PENDING' }, { status: 202 });
  };
  const config = { baseUrl: 'http://localhost:3000', secret: 'test-secret' };
  const first = await runFbmWorkerTick(config, transport);
  await runFbmWorkerTick(config, transport);
  assert.deepEqual(paths.map(p => p.split('/').pop()), ['generate', 'recover', 'generate', 'recover']);
  assert.ok(paths.every(p => p.startsWith('/api/cron/amazon/fbm-inventory-snapshot/')));
  assert.doesNotMatch(JSON.stringify(first), /test-secret/);
});
test('restart rechecks daily generation; server owns dedupe, browser is not involved', async () => {
  let calls = 0;
  await runFbmWorkerTick({ baseUrl: 'https://example.test', secret: 's' }, async () => { calls++; return Response.json({ status: 'COMPLETED' }); });
  assert.equal(calls, 2);
});
test('failed HTTP calls do not replay inside a tick and recovery is independent', async () => {
  let calls = 0;
  const r = await runFbmWorkerTick({ baseUrl: 'https://example.test', secret: 's' }, async () => { calls++; throw new Error('secret upstream error'); });
  assert.equal(calls, 2); assert.equal(r.generation.status, 'UNAVAILABLE'); assert.doesNotMatch(JSON.stringify(r), /secret upstream/);
});
test('worker cannot start implicitly or send credentials over remote HTTP', async () => {
  await assert.rejects(serveFbmWorker([]), /EXPLICIT_SERVE_REQUIRED/);
  await assert.rejects(runFbmWorkerTick({ baseUrl: 'http://example.test', secret: 's' }), /INVALID_URL/);
});
