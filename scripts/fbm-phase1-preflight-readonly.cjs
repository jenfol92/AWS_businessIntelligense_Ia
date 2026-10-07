// Read-only schema/contract probe. Never prints credentials or business rows.
const { loadEnvConfig } = require('@next/env');
loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  for (const [table, columns] of [
    ['amazon_spapi_report_jobs', 'id,report_type,source,raw'],
    ['amazon_fbm_inventory_snapshot_runs', 'id,observed_at,completed_at,marketplace_id,publication_ready,canonical_row_count'],
    ['amazon_fbm_inventory_snapshots', 'snapshot_run_id,producto_id,sku_limpio,seller_sku,asin,marketplace_id,available_quantity,observed_at'],
    ['v_latest_amazon_fbm_inventory_by_product', 'producto_id,marketplace_id,stock_fbm,observed_at,seller_sku_count'],
  ]) {
    const { error } = await db.from(table).select(columns).limit(0);
    console.log(JSON.stringify({ table, accessible: !error, error: error ? { code: error.code, message: error.message } : null }));
    if (error) process.exitCode = 1;
  }
  if (process.exitCode) return;
  const { data: runs, error: runsError } = await db.from('amazon_fbm_inventory_snapshot_runs')
    .select('id,marketplace_id,observed_at,completed_at').eq('status', 'COMPLETE').eq('publication_ready', true)
    .order('observed_at', { ascending: false }).order('completed_at', { ascending: false }).limit(1000);
  if (runsError) throw new Error('RUN_READ_FAILED');
  const latest = new Map();
  for (const run of runs) if (!latest.has(run.marketplace_id)) latest.set(run.marketplace_id, run);
  async function pages(table, columns, runId) {
    const rows = [];
    for (let offset = 0; offset < 100000; offset += 500) {
      let query = db.from(table).select(columns).order('producto_id').order('marketplace_id').range(offset, offset + 499);
      if (runId) query = query.eq('snapshot_run_id', runId);
      const { data, error } = await query;
      if (error) throw new Error('CANONICAL_READ_FAILED');
      rows.push(...data);
      if (data.length < 500) return rows;
    }
    throw new Error('READ_LIMIT');
  }
  const expected = new Map();
  for (const run of latest.values()) {
    for (const row of await pages('amazon_fbm_inventory_snapshots', 'producto_id,marketplace_id,available_quantity,observed_at', run.id)) {
      const key = row.producto_id + ':' + row.marketplace_id;
      const aggregate = expected.get(key) ?? { stock: 0, count: 0, at: '' };
      aggregate.stock += Number(row.available_quantity); aggregate.count++;
      aggregate.at = [aggregate.at, new Date(row.observed_at).toISOString()].sort().at(-1);
      expected.set(key, aggregate);
    }
  }
  const view = await pages('v_latest_amazon_fbm_inventory_by_product', 'producto_id,marketplace_id,stock_fbm,observed_at,seller_sku_count');
  const matches = view.length === expected.size && view.every(row => {
    const e = expected.get(row.producto_id + ':' + row.marketplace_id);
    return e && e.stock === Number(row.stock_fbm) && e.count === row.seller_sku_count && e.at === new Date(row.observed_at).toISOString();
  });
  console.log(JSON.stringify({ viewMatchesLatestPublishedSnapshots: matches, marketplacesChecked: latest.size, canonicalProductsChecked: expected.size,
    note: 'Current data equivalence; local SQL definition audited separately. No data changed.' }));
  if (!matches) process.exitCode = 1;
})().catch(e => { console.error(e.name); process.exitCode = 1; });
