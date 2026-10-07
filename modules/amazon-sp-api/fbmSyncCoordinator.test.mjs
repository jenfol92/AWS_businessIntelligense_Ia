import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { coordinateFbmSync } from './fbmSyncCoordinator.ts';
import * as policy from './fbmSyncPolicy.ts';
import * as dedup from './reportRequestDedupPolicy.ts';
import * as snapshot from './fbmReportsSnapshot.ts';
import { commitCompleteFbmReportSnapshot } from './fbmReportsCommit.ts';
import * as reconciliation from './fbmIdentityReconciliation.ts';

const require = createRequire(import.meta.url), ts = require('typescript');
globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN_IN_FBM_TESTS'); };
import { PGlite } from '@electric-sql/pglite';
const read = path => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
function compile(path, dependencies, transform = text => text) {
  const js = ts.transpileModule(transform(read(path)), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const compiledModule = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => name in dependencies ? dependencies[name] : require(name), compiledModule, compiledModule.exports);
  return compiledModule.exports;
}

// Executes the production repository's actual CAS filters against isolated PostgreSQL.
// No app environment, network client, Amazon or deployed database is loaded.
function client(db) {
  const field = name => name.split(/(->>|->)/).map((p, i) => i % 2 ? p : i ? `'${p}'` : `"${p}"`).join('');
  return { from(table) {
    let operation = 'select', payload, columns = '*', conditions = [], orders = [], limit, offset, single = false;
    const q = {
      select(value = '*') { columns = value; return q; },
      insert(value) { operation = 'insert'; payload = value; return q; },
      update(value) { operation = 'update'; payload = value; return q; },
      eq(key, value) { conditions.push([key, '=', value]); return q; },
      neq(key, value) { conditions.push([key, '<>', value]); return q; },
      not(key, op, value) { assert.equal(op, 'is'); assert.equal(value, null); conditions.push([key, 'IS NOT NULL']); return q; },
      or(value) { assert.equal(value, 'status.eq.SUBMITTED,processing_status.in.(IN_QUEUE,IN_PROGRESS,PROCESSING),processing_status.is.null'); conditions.push(['__pending__']); return q; },
      gt(key, value) { conditions.push([key, '>', value]); return q; },
      is(key, value) { assert.equal(value, null); conditions.push([key, 'IS NULL']); return q; },
      order(key, opts = {}) { orders.push(field(key) + (opts.ascending === false ? ' DESC' : ' ASC')); return q; },
      limit(value) { limit = value; return q; },
      range(start, end) { offset = start; limit = end - start + 1; return q; },
      abortSignal() { return q; },
      maybeSingle() { single = true; return q; },
      single() { single = true; return q; },
      async then(resolve, reject) {
        try {
          const args = [], param = v => { args.push(v); return '$' + args.length; };
          let sql;
          if (operation === 'insert') sql = `INSERT INTO ${table} (${Object.keys(payload).map(field)}) VALUES (${Object.entries(payload).map(([k, v]) => param(k === 'raw' ? JSON.stringify(v) : v))})`;
          else if (operation === 'update') sql = `UPDATE ${table} SET ${Object.entries(payload).map(([k, v]) => `${field(k)}=${param(k === 'raw' ? JSON.stringify(v) : v)}`)}`;
          else sql = `SELECT ${columns} FROM ${table}`;
          if (conditions.length) sql += ' WHERE ' + conditions.map(([k, op, v]) => k === '__pending__' ? "(status='SUBMITTED' OR processing_status IN ('IN_QUEUE','IN_PROGRESS','PROCESSING') OR processing_status IS NULL)" : `${field(k)} ${op}${op.startsWith('IS ') ? '' : ' ' + param(v)}`).join(' AND ');
          if (operation !== 'select') sql += ` RETURNING ${columns}`;
          if (orders.length) sql += ' ORDER BY ' + orders.join(',');
          if (limit !== undefined) sql += ' LIMIT ' + limit;
          if (offset !== undefined) sql += ' OFFSET ' + offset;
          const data = (await db.query(sql, args)).rows;
          return resolve({ data: single ? data[0] ?? null : data, error: null });
        } catch (error) { return resolve({ data: null, error: { code: error.code, message: error.message } }); }
      },
    };
    return q;
  } };
}

test('FBM durable phases with real PostgreSQL claim/CAS and restart', async t => {
  const db = new PGlite();
  await db.exec(read('sql/migrations/amazon_spapi_report_jobs.sql'));
  const supabaseAdmin = client(db);
  const jobs = compile('modules/amazon-sp-api/reportJobsRepository.ts', {
    '@/server/supabase/adminClient': { supabaseAdmin }, './reportRequestDedupPolicy': dedup,
  });
  const repo = compile('modules/amazon-sp-api/fbmSyncRepository.ts', {
    '@/server/supabase/adminClient': { supabaseAdmin }, './reportJobsRepository': jobs,
    './fbmReportsSnapshot': snapshot, './fbmSyncPolicy': policy,
  });
  let creates, polls, publications, status, failCreate, failPoll, failPublish, committed;
  const deps = () => ({
    now: Date.now, findOrCreate: repo.findOrCreateFbmJob, acquire: repo.acquireFbmJob,
    save: job => repo.saveFbmJob(job), release: job => repo.saveFbmJob(job, true),
    prepare: async () => 'exact-product-seller-sku-set',
    create: async () => { creates++; if (failCreate) throw failCreate; return 'REPORT-1'; },
    poll: async id => { polls++; assert.equal(id, 'REPORT-1'); if (failPoll) throw failPoll; return { processingStatus: status, documentId: 'DOC-1', observedAt: '2026-09-29T00:00:00.000Z' }; },
    publish: async (job, checkpoint) => {
      job.state.publication = { runId: job.id, rows: 2, digest: 'same-payload' }; await checkpoint();
      if (!committed) { publications++; committed = true; }
      if (failPublish) { const e = failPublish; failPublish = null; throw e; }
      return 2;
    },
    errorInfo: e => ({ rateLimited: e.code === '429', temporary: e.code !== 'fatal', retryAfter: e.retryAfter, code: e.code ?? 'TEMPORARY' }),
  });
  async function reset() {
    await db.exec('TRUNCATE amazon_spapi_report_jobs');
    creates = polls = publications = 0; status = 'IN_QUEUE'; committed = false; failCreate = failPoll = failPublish = null;
  }
  async function due() {
    await db.exec(`UPDATE amazon_spapi_report_jobs SET raw=jsonb_set(raw,'{fbm,nextAttemptAt}','null')`);
  }
  const run = options => coordinateFbmSync(options, deps());
  await t.test('two simultaneous CREATE callers share one job and one Amazon report', async () => {
    await reset(); const results = await Promise.all([run(), run()]);
    assert.equal(creates, 1); assert.equal(new Set(results.map(r => r.jobId)).size, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM amazon_spapi_report_jobs')).rows[0].n, 1);
  });
  await t.test('restart resumes persisted reportId, pending is not failure, DONE only transitions', async () => {
    await reset(); const created = await run(); assert.equal(created.status, 'PENDING'); assert.equal(created.phase, 'POLL');
    for (const next of ['IN_QUEUE', 'IN_PROGRESS']) {
      await due(); status = next; const response = await run({ recoveryOnly: true });
      assert.equal(response.jobId, created.jobId); assert.equal(response.status, 'PROCESSING'); assert.equal(response.error, null);
    }
    await due(); status = 'DONE'; const ready = await run(); assert.equal(ready.phase, 'PUBLISH'); assert.equal(publications, 0);
    const done = await run(); assert.equal(done.status, 'COMPLETED'); assert.equal(done.rowsCommitted, 2);
    assert.equal(creates, 1); assert.equal(polls, 3);
  });
  for (const terminal of ['CANCELLED', 'FATAL']) await t.test(terminal + ' is explicit and retains the report', async () => {
    await reset(); await run(); await due(); status = terminal;
    const response = await run(); assert.equal(response.status, terminal); assert.equal(response.reportId, 'REPORT-1'); assert.equal(publications, 0);
  });
  for (const code of ['429', 'timeout', '503']) await t.test(code + ' is recoverable without losing report', async () => {
    await reset(); const initial = await run(); await due(); failPoll = Object.assign(new Error(), { code, retryAfter: '120' });
    const waiting = await run(); assert.equal(waiting.status, code === '429' ? 'RATE_LIMITED' : 'PENDING'); assert.ok(waiting.nextAttemptAt);
    failPoll = null; await due(); status = 'DONE'; const recovered = await run(); assert.equal(recovered.jobId, initial.jobId); assert.equal(recovered.phase, 'PUBLISH'); assert.equal(creates, 1);
  });
  await t.test('uncertain CREATE never regenerates on retries or server restart', async () => {
    await reset(); failCreate = new Error('network timeout'); const uncertain = await run();
    assert.equal(uncertain.status, 'CREATE_UNCERTAIN');
    failCreate = null; await run(); await run({ recoveryOnly: true }); assert.equal(creates, 1);
  });
  await t.test('crash between durable intent and receiving report is uncertain', async () => {
    await reset(); const job = await repo.findOrCreateFbmJob({}); const owned = await repo.acquireFbmJob(job);
    owned.state.createIntentAt = new Date().toISOString(); await repo.saveFbmJob(owned, true);
    const resumed = await run(); assert.equal(resumed.status, 'CREATE_UNCERTAIN'); assert.equal(creates, 0);
  });
  await t.test('definite CREATE 429 may retry creation', async () => {
    await reset(); failCreate = Object.assign(new Error(), { code: '429' }); assert.equal((await run()).status, 'RATE_LIMITED');
    await due(); failCreate = null; assert.equal((await run()).phase, 'POLL'); assert.equal(creates, 2);
  });
  await t.test('manual + cron simultaneous PUBLISH and repeated job do not duplicate', async () => {
    await reset(); await run(); await due(); status = 'DONE'; const ready = await run();
    await Promise.all([run({ jobId: ready.jobId }), run({ recoveryOnly: true })]);
    assert.equal((await run({ jobId: ready.jobId })).status, 'COMPLETED'); assert.equal(publications, 1);
  });
  await t.test('lost commit response is reconciled on the same publication ID', async () => {
    await reset(); await run(); await due(); status = 'DONE'; await run(); failPublish = new Error('lost response');
    assert.equal((await run()).status, 'PENDING'); await due(); assert.equal((await run()).status, 'COMPLETED'); assert.equal(publications, 1);
  });
  await t.test('stale worker cannot checkpoint after another lease takes ownership', async () => {
    await reset(); const first = await repo.acquireFbmJob(await repo.findOrCreateFbmJob({}));
    await db.exec(`UPDATE amazon_spapi_report_jobs SET raw=jsonb_set(raw,'{fbm,lease,expiresAt}','"2000-01-01T00:00:00.000Z"')`);
    const second = await repo.acquireFbmJob(await repo.findOrCreateFbmJob({})); assert.ok(second);
    await assert.rejects(repo.saveFbmJob(first), /LEASE_LOST/); await repo.saveFbmJob(second, true);
  });
  await t.test('recovery never creates jobs in an empty database', async () => {
    await reset(); assert.equal(await run({ recoveryOnly: true }), null); assert.equal(creates, 0);
  });
  await t.test('terminal retry is explicit and concurrent retries claim the same successor', async () => {
    await reset(); await run(); await due(); status = 'CANCELLED'; const failed = await run();
    await run({ recoveryOnly: true }); assert.equal(creates, 1);
    const retries = await Promise.all([run({ retryAfterJobId: failed.jobId }), run({ retryAfterJobId: failed.jobId })]);
    assert.equal(new Set(retries.map(r => r.jobId)).size, 1); assert.notEqual(retries[0].jobId, failed.jobId); assert.equal(creates, 2);
  });
  await t.test('FAILED recovery is inert and COMPLETED recovery never republishes', async () => {
    await reset(); await run(); await due(); failPoll = Object.assign(new Error(), { code: 'fatal' });
    assert.equal((await run({ recoveryOnly: true })).status, 'FAILED');
    const checked = polls; failPoll = null;
    assert.equal((await run({ recoveryOnly: true })).status, 'FAILED'); assert.equal(polls, checked);
    await reset(); await run(); await due(); status = 'DONE'; await run({ recoveryOnly: true });
    await run({ recoveryOnly: true }); await run({ recoveryOnly: true });
    assert.equal(publications, 1); assert.equal(creates, 1);
  });
  await db.close();
});

test('manual/automation configuration is independent and status 202 is pending', () => {
  assert.equal(policy.fbmManualEnabled({ NODE_ENV: 'development', AMAZON_FBM_REPORTS_SYNC_ENABLED: 'false' }), true);
  assert.equal(policy.fbmManualEnabled({ NODE_ENV: 'production', AMAZON_FBM_REPORTS_SYNC_ENABLED: 'true' }), false);
  assert.equal(policy.fbmRecoveryEnabled({ NODE_ENV: 'production', AMAZON_FBM_MANUAL_SYNC_ENABLED: 'true' }), true);
  for (const status of ['PENDING', 'PROCESSING', 'RATE_LIMITED']) assert.equal(policy.fbmHttpStatus(status), 202);
  assert.equal(policy.fbmHttpStatus('COMPLETED'), 200);
});

test('generic selector excludes ONLY FBM: existing All Orders/FBA/Country/Ledger selection unchanged', async () => {
  const db = new PGlite(); await db.exec(read('sql/migrations/amazon_spapi_report_jobs.sql'));
  const supabaseAdmin = client(db), dependencies = { '@/server/supabase/adminClient': { supabaseAdmin }, './reportRequestDedupPolicy': dedup };
  const current = compile('modules/amazon-sp-api/reportJobsRepository.ts', dependencies);
  const before = compile('modules/amazon-sp-api/reportJobsRepository.ts', dependencies, text => text.replace('    .neq("source", "fbm_reports_coordinator_v1")\n', ''));
  for (const source of ['manual', 'scheduler', 'all_orders_by_order_date_sync', 'fba_sales_coordinator', policy.FBM_JOB_OWNER]) {
    await db.query(`INSERT INTO amazon_spapi_report_jobs(report_type,source,status,report_id) VALUES('test',$1,'SUBMITTED',$1)`, [source]);
  }
  const oldIds = (await before.listAmazonReportJobsPendingPoll()).filter(j => j.source !== policy.FBM_JOB_OWNER).map(j => j.id).sort();
  const newJobs = await current.listAmazonReportJobsPendingPoll();
  assert.deepEqual(newJobs.map(j => j.id).sort(), oldIds);
  assert.ok(newJobs.some(j => j.source === 'all_orders_by_order_date_sync'));
  assert.ok(!newJobs.some(j => j.source === policy.FBM_JOB_OWNER)); await db.close();
});

test('production PUBLISH adapter confirms exact snapshot, reconciles lost response and duplicate RPC', async () => {
  const db = new PGlite();
  const product = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await db.exec(`CREATE TABLE productos(id uuid PRIMARY KEY); INSERT INTO productos VALUES('${product}');`);
  await db.exec(read('sql/migrations/20260903_01_amazon_fbm_inventory_atomic_snapshot.sql'));
  const supabaseAdmin = client(db);
  const identities = [{ productoId: product, sellerSku: 'SKU-EXACT', skuLimpio: 'SKU-EXACT' }];
  let commits = 0, downloads = 0, checkpoints = 0, loseResponse = true;
  const runtime = compile('modules/amazon-sp-api/fbmSyncRuntime.ts', {
    '@/server/supabase/adminClient': { supabaseAdmin }, './config': { loadSpApiConfig: () => ({ region: 'EU', endpoint: 'https://sellingpartnerapi-eu.amazon.com', useAwsSigV4: false }) },
    './reportsClient': { getReportDocument: async id => ({ reportDocumentId: id }), downloadReportDocument: async () => { downloads++; return 'seller-sku\tquantity\tfulfillment-channel\tasin1\nSKU-EXACT\t7\tDEFAULT\tB012345678'; } },
    './errors': { safeSpApiErrorMetadata: () => ({}) }, './fbmProductIdentityRepository': {
      loadCanonicalFbmProductIdentities: async () => identities,
      loadFbmIdentityProducts: async () => identities.map(i => ({ id: i.productoId, sku: i.sellerSku, asin: 'B012345678', estado: 'activo' })),
    }, './fbmIdentityReconciliation': reconciliation,
    './fbmReportsSnapshot': snapshot, './fbmSyncPolicy': policy, './fbmSyncRepository': {},
    './fbmReportsCommit': { commitCompleteFbmReportSnapshot: (...args) => commitCompleteFbmReportSnapshot(...args, async input => {
      commits++;
      try {
        const { rows } = await db.query('SELECT commit_amazon_fbm_inventory_snapshot_run($1,$2,$3,$4,$5,$6,$7) AS n',
          [input.p_run_id, input.p_observed_at, input.p_marketplace_id, input.p_expected_identity_count, input.p_completed_identity_count, input.p_capture_complete, JSON.stringify(input.p_rows)]);
        if (loseResponse) { loseResponse = false; return { error: 'RESPONSE_LOST' }; }
        return { data: rows[0].n, error: null };
      } catch (error) { return { data: null, error }; }
    }) },
  });
  const deps = await runtime.createFbmSyncDependencies();
  const job = { id: jobId, state: { ...policy.initialFbmState(), phase: 'PUBLISH', reportId: 'R1', documentId: 'D1', observedAt: '2026-09-29T00:00:00.000Z', identityKey: await deps.prepare() } };
  assert.equal(await deps.publish(job, async () => { checkpoints++; }), 1);
  assert.equal(commits, 1); assert.equal(checkpoints, 1);
  assert.equal(await deps.publish(structuredClone(job), async () => {}), 1); assert.equal(downloads, 1); assert.equal(commits, 1);
  // Both workers can have passed the read before one commits: the DB primary key is the final fence.
  const retry = structuredClone(job); retry.state.publication = null;
  assert.equal(await deps.publish(retry, async () => {}), 1); assert.equal(commits, 2);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM amazon_fbm_inventory_snapshots')).rows[0].n, 1);
  await db.exec('UPDATE amazon_fbm_inventory_snapshots SET available_quantity=99');
  await assert.rejects(deps.publish(job, async () => {}), /PUBLICATION_MISMATCH/);
  await db.close();
});

test('FBM duplicate/invalid identity errors are permanent, never a rate-limit retry', async () => {
  const runtime = compile('modules/amazon-sp-api/fbmSyncRuntime.ts', {
    '@/server/supabase/adminClient': {}, './config': {}, './reportsClient': {}, './errors': { safeSpApiErrorMetadata: () => ({}) },
    './fbmProductIdentityRepository': {}, './fbmIdentityReconciliation': reconciliation,
    './fbmReportsSnapshot': snapshot, './fbmReportsCommit': {}, './fbmSyncPolicy': policy, './fbmSyncRepository': {},
  });
  const deps = await runtime.createFbmSyncDependencies();
  for (const code of ['FBM_DUPLICATE_PRODUCT_SKU:SKU-test', 'FBM_INVALID_IDENTITIES', 'FBM_IDENTITY_UNIVERSE_CHANGED']) {
    const info = deps.errorInfo(new Error(code)); assert.equal(info.temporary, false); assert.equal(info.rateLimited, false);
  }
});

test('FBM reconciles business removals and preserves atomic coverage/publication gates', async t => {
  const db = new PGlite();
  const ids = ['00000000-0000-4000-a000-000000000001', '00000000-0000-4000-a000-000000000002', '00000000-0000-4000-a000-000000000003'];
  const oldRun = '00000000-0000-4000-a000-000000000010', newRun = '00000000-0000-4000-a000-000000000020';
  await db.exec(`CREATE TABLE productos(id uuid PRIMARY KEY); INSERT INTO productos VALUES ${ids.map(id => `('${id}')`).join(',')};`);
  await db.exec(read('sql/migrations/20260903_01_amazon_fbm_inventory_atomic_snapshot.sql'));
  const supabaseAdmin = client(db);
  const products = ids.map((id, i) => ({ id, sku: 'SKU-' + i, asin: 'B012345678', estado: 'activo' }));
  const frozen = JSON.stringify(products.map(p => [p.id, p.sku]));
  const report = rows => 'seller-sku\tquantity\tfulfillment-channel\tasin1\n' + rows.map(([sku, n]) => `${sku}\t${n}\tDEFAULT\tB012345678`).join('\n');
  const full = products.map((p, i) => [p.sku, i + 6]);
  for (const c of [
    { name: 'discontinued removal publishes the remaining covered active identities', current: products.map((p, i) => i === 2 ? { ...p, estado: 'descatalogado' } : p), rows: full.slice(0, 2), expected: 2 },
    { name: 'addition blocks before downloading', current: [...products, { id: 'new', sku: 'SKU-new', asin: 'B012345678', estado: 'activo' }], error: 'FBM_IDENTITY_UNIVERSE_CHANGED' },
    { name: 'changed SKU blocks', current: products.map((p, i) => i === 0 ? { ...p, sku: 'CHANGED' } : p), error: 'FBM_IDENTITY_UNIVERSE_CHANGED' },
    { name: 'unexplained deletion blocks', current: products.slice(0, 2), error: 'FBM_IDENTITY_UNIVERSE_CHANGED' },
    { name: 'duplicate identity blocks', current: [...products, products[0]], error: 'FBM_IDENTITY_UNIVERSE_CHANGED' },
    { name: 'discontinuation does not hide missing active coverage', current: products.map((p, i) => i === 2 ? { ...p, estado: 'descatalogado' } : p), rows: full.slice(0, 1), error: 'REPORT_COVERAGE_ERROR' },
    { name: 'invalid quantity blocks without inserting a run', current: products, rows: [['SKU-0', '-1'], ...full.slice(1)], error: 'REPORT_QUANTITY_ERROR' },
    { name: 'duplicate report rows still block', current: products, rows: [...full, full[0]], error: 'REPORT_DUPLICATE_ERROR' },
    { name: 'unchanged valid universe publishes atomically', current: products, rows: full, expected: 3 },
    { name: 'discontinuation during download is reconciled even if the removed SKU is absent in the report', current: products, final: products.map((p, i) => i === 2 ? { ...p, estado: 'descatalogado' } : p), rows: full.slice(0, 2), expected: 2 },
    { name: 'addition during download blocks at the second validation', current: products, final: [...products, { id: 'new', sku: 'SKU-new', asin: 'B012345678', estado: 'activo' }], rows: full, error: 'FBM_IDENTITY_UNIVERSE_CHANGED' },
  ]) await t.test(c.name, async () => {
    await db.exec('TRUNCATE amazon_fbm_inventory_snapshots,amazon_fbm_inventory_snapshot_runs');
    const oldRows = products.map(p => ({ producto_id: p.id, sku_limpio: p.sku, seller_sku: p.sku, asin: p.asin, marketplace_id: snapshot.FBM_REPORT_MARKETPLACE, available_quantity: 12, observed_at: '2026-10-01T00:00:00Z' }));
    const commit = async args => {
      try { const r = await db.query('SELECT commit_amazon_fbm_inventory_snapshot_run($1,$2,$3,$4,$5,$6,$7) AS n', [args.p_run_id, args.p_observed_at, args.p_marketplace_id, args.p_expected_identity_count, args.p_completed_identity_count, args.p_capture_complete, JSON.stringify(args.p_rows)]); return { data: r.rows[0].n, error: null }; }
      catch (error) { return { data: null, error }; }
    };
    await commitCompleteFbmReportSnapshot(oldRun, '2026-10-01T00:00:00Z', 3, oldRows, AbortSignal.timeout(10000), commit);
    let reads = 0, commits = 0;
    const runtime = compile('modules/amazon-sp-api/fbmSyncRuntime.ts', {
      '@/server/supabase/adminClient': { supabaseAdmin }, './config': {}, './errors': { safeSpApiErrorMetadata: () => ({}) },
      './reportsClient': { getReportDocument: async id => ({ reportDocumentId: id }), downloadReportDocument: async () => report(c.rows ?? full) },
      './fbmProductIdentityRepository': { loadFbmIdentityProducts: async () => ++reads === 1 ? c.current : c.final ?? c.current },
      './fbmIdentityReconciliation': reconciliation, './fbmReportsSnapshot': snapshot, './fbmSyncPolicy': policy, './fbmSyncRepository': {},
      './fbmReportsCommit': { commitCompleteFbmReportSnapshot: (...args) => { commits++; return commitCompleteFbmReportSnapshot(...args, commit); } },
    });
    const deps = await runtime.createFbmSyncDependencies();
    const job = { id: newRun, state: { ...policy.initialFbmState(), phase: 'PUBLISH', documentId: 'D-new', observedAt: '2026-10-08T00:00:00.000Z', identityKey: frozen } };
    if (c.error) {
      await assert.rejects(deps.publish(job, async () => {}), new RegExp(c.error)); assert.equal(commits, 0);
      assert.equal((await db.query('SELECT count(*)::int n FROM amazon_fbm_inventory_snapshot_runs')).rows[0].n, 1);
      assert.equal((await db.query('SELECT stock_fbm FROM v_latest_amazon_fbm_inventory_by_product ORDER BY producto_id')).rows[0].stock_fbm, 12);
    } else {
      assert.equal(await deps.publish(job, async () => {}), c.expected); assert.equal(commits, 1);
      const run = (await db.query('SELECT * FROM amazon_fbm_inventory_snapshot_runs WHERE id=$1', [newRun])).rows[0];
      assert.equal(run.status, 'COMPLETE'); assert.equal(run.publication_ready, true); assert.equal(run.canonical_row_count, c.expected);
      assert.equal((await db.query('SELECT count(*)::int n FROM v_latest_amazon_fbm_inventory_by_product')).rows[0].n, c.expected);
      assert.equal(job.state.identityKey, frozen); // Initial evidence is not rewritten.
    }
  });
  await db.close();
});

test('Country upsert cannot restore stale stock_fbm after a concurrent FBM update', async () => {
  const db = new PGlite();
  await db.exec("CREATE TABLE inventario_paises(producto_id text,pais text,stock_fba int,stock_fbm int,marketplace_id text,updated_at timestamptz,PRIMARY KEY(producto_id,pais)); INSERT INTO inventario_paises VALUES('P','ES',1,10,NULL,now());");
  const repo = compile('modules/imports/amazon-fba-inventory-by-country/repository.ts', {
    '@/modules/imports/shared/amazonMarketplaceIds': {},
    '@/server/supabase/adminClient': { supabaseAdmin: { from(table) {
      assert.equal(table, 'inventario_paises');
      return { async upsert(rows) {
        // FBM changes after Country started; the actual production payload must omit FBM.
        await db.exec("UPDATE inventario_paises SET stock_fbm=55 WHERE producto_id='P'");
        for (const row of rows) {
          assert.equal(Object.hasOwn(row, 'stock_fbm'), false);
          const keys = Object.keys(row);
          await db.query(`INSERT INTO inventario_paises(${keys}) VALUES(${keys.map((_, i) => '$' + (i + 1))}) ON CONFLICT(producto_id,pais) DO UPDATE SET ${keys.filter(k => !['producto_id','pais'].includes(k)).map(k => k + '=EXCLUDED.' + k)}`, Object.values(row));
        }
        return { error: null };
      } };
    } } },
  });
  assert.equal(await repo.upsertInventarioPaisesStockFba([{ producto_id: 'P', pais: 'ES', stock_fba: 20, marketplace_id: 'M' }]), 1);
  assert.deepEqual((await db.query('SELECT stock_fba,stock_fbm FROM inventario_paises')).rows, [{ stock_fba: 20, stock_fbm: 55 }]); await db.close();
});

test('manual FBM requires a session and shares its coordinator with protected cron; pending is HTTP 202', async () => {
  let calls = 0, authorized = true, status = 'PENDING';
  const coordinate = async () => { calls++; return { status, ok: status === 'COMPLETED', jobId: 'J1' }; };
  const dependencies = {
    'next/server': { NextResponse: Response },
    '@/server/supabase/routeClient': { createSupabaseRouteClient: () => ({ auth: { getUser: async () => ({ data: { user: authorized ? { id: 'member', app_metadata: { role: 'accounting' } } : null } }) } }) },
    '@/modules/amazon-sp-api/fbmSyncCoordinator': { coordinateFbmSync: coordinate },
    '@/modules/amazon-sp-api/fbmSyncRepository': { findOrCreateFbmJob: async () => null },
    '@/modules/amazon-sp-api/fbmSyncPolicy': policy,
  };
  const manual = compile('app/api/amazon/inventory/fbm-snapshot/import/route.ts', dependencies);
  const cron = compile('modules/amazon-sp-api/fbmReportsEntrypoint.ts', {
    './fbmSyncCoordinator.ts': { coordinateFbmSync: coordinate }, './fbmSyncPolicy.ts': policy,
  });
  const previous = { secret: process.env.CRON_SECRET, enabled: process.env.AMAZON_FBM_REPORTS_SYNC_ENABLED, manual: process.env.AMAZON_FBM_MANUAL_SYNC_ENABLED };
  const request = token => new Request('http://localhost/fbm', { method: 'POST', body: '{}', headers: token ? { authorization: 'Bearer ' + token } : {} });
  try {
    process.env.AMAZON_FBM_MANUAL_SYNC_ENABLED = 'true'; process.env.AMAZON_FBM_REPORTS_SYNC_ENABLED = 'false'; process.env.CRON_SECRET = 'local-only';
    const observationRequest = { nextUrl: new URL('http://localhost/fbm') };
    authorized = false; assert.equal((await manual.POST(request())).status, 401); assert.equal((await manual.GET(observationRequest)).status, 401); assert.equal(calls, 0);
    authorized = true; assert.equal((await manual.GET(observationRequest)).status, 200); assert.equal(calls, 0);
    assert.equal((await manual.POST(request())).status, 202); assert.equal(calls, 1);
    assert.equal((await cron.handleFbmReportsSync(request('local-only'))).status, 503); assert.equal(calls, 1);
    process.env.AMAZON_FBM_REPORTS_SYNC_ENABLED = 'true';
    assert.equal((await cron.handleFbmReportsSync(request('wrong'))).status, 401);
    for (const next of ['PENDING', 'PROCESSING', 'RATE_LIMITED', 'COMPLETED', 'CANCELLED', 'FATAL']) {
      status = next;
      assert.equal((await manual.POST(request())).status, policy.fbmHttpStatus(next));
      assert.equal((await cron.handleFbmReportsSync(request('local-only'))).status, policy.fbmHttpStatus(next));
    }
    const button = read('modules/inventory/components/FbmSyncButton.tsx');
    assert.match(button, /\/api\/amazon\/inventory\/fbm-snapshot\/import/);
    assert.match(button, /response\.status === 202/); assert.match(button, /busy\.current \|\| pending\(job\)/);
    assert.match(button, /fetch\(endpoint, \{ cache: "no-store"/); // Observation is GET, never a publishing loop.
    assert.match(read('app/api/cron/amazon/reports/run/route.ts'), /await recoverPendingFbmSync\(\)/);
    assert.match(read('modules/amazon-sp-api/fbmSyncRecovery.ts'), /coordinateFbmSync\(\{ recoveryOnly: true \}\)/);
  } finally {
    for (const [key, value] of [['CRON_SECRET', previous.secret], ['AMAZON_FBM_REPORTS_SYNC_ENABLED', previous.enabled], ['AMAZON_FBM_MANUAL_SYNC_ENABLED', previous.manual]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Inventory country rows use canonical FBM, retain literal zero, never resurrect legacy FBM', () => {
  const { buildCountryRowsForProduct } = compile('modules/inventory/services/buildInventoryProduct.ts', {
    './resolveOperationalStock': {},
    './inventoryMetrics': { avgDaily: () => 0, coverageDays: () => null, countryRisk: () => 'ok', salesKey: (id, country) => id + country },
  });
  const ctx = { inventoryRows: [{ producto_id: 'P', pais: 'ES', stock_fba: 5, stock_fbm: 999 }],
    fbaInventoryCountryLatest: new Map([['P', [{ pais: 'ES', stockSellable: 5 }]]]),
    fbmInventorySnapshotLatest: new Map(), sales: { byProductCountry: new Map() }, marketplaceSales: { byProductMarketplace: new Map() } };
  assert.equal(buildCountryRowsForProduct('P', ctx)[0].stockFbm, null);
  ctx.fbmInventorySnapshotLatest.set('P', { availableQuantity: 0 });
  assert.equal(buildCountryRowsForProduct('P', ctx)[0].stockFbm, 0);
  ctx.fbmInventorySnapshotLatest.set('P', { availableQuantity: 7 });
  assert.equal(buildCountryRowsForProduct('P', ctx)[0].stockFbm, 7);
});
