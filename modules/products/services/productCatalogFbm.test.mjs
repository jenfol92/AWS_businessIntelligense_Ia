import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url), ts = require('typescript');
globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
const read = path => fs.readFileSync(new URL('../../../' + path, import.meta.url), 'utf8');
function compile(path, dependencies) {
  const js = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => name in dependencies ? dependencies[name] : require(name), module, module.exports);
  return module.exports;
}
function reader(data, error = null) {
  const calls = [];
  const q = { select(columns) { calls.push(['select', columns]); return q; }, eq(...args) { calls.push(['eq', ...args]); return q; },
    in(...args) { calls.push(['in', ...args]); return q; }, limit(n) { calls.push(['limit', n]); return Promise.resolve({ data, error }); } };
  const repo = compile('modules/products/repositories/productCatalogFbmRepository.ts', {
    '@/server/supabase/routeClient': { createSupabaseRouteClient: () => ({ from(table) { calls.push(['from', table]); return q; } }) },
  });
  return { repo, calls };
}
test('catalog uses one batched canonical ES read, preserves actual zero and unknown absence', async () => {
  const { repo, calls } = reader([{ producto_id: 'A', stock_fbm: '8', observed_at: '2026-10-08T00:00:00Z' }, { producto_id: 'B', stock_fbm: 0, observed_at: '2026-10-08T00:00:00Z' }]);
  const stocks = await repo.findPublishedCatalogFbm(['A', 'B', 'C', 'A']);
  assert.equal(stocks.get('A').quantity, 8); assert.equal(stocks.get('B').quantity, 0);
  assert.equal(stocks.get('C').quantity, null); assert.equal(stocks.get('C').status, 'NO_SNAPSHOT');
  assert.equal(calls.filter(c => c[0] === 'from').length, 1);
  assert.deepEqual(calls.find(c => c[0] === 'eq'), ['eq', 'marketplace_id', 'A1RKKUPIHCS9HS']);
  assert.deepEqual(calls.find(c => c[0] === 'in'), ['in', 'producto_id', ['A', 'B', 'C']]);
  calls.length = 0; await repo.findPublishedCatalogFbm([]); assert.equal(calls.length, 0);
});
test('read failures and malformed/ambiguous canonical rows never fall back to legacy stock', async () => {
  for (const [data, error] of [
    [[], { code: 'NO_GRANT' }],
    [[{ producto_id: 'A', stock_fbm: -1, observed_at: '2026-10-08' }], null],
    [[{ producto_id: 'A', stock_fbm: 5, observed_at: 'invalid' }], null],
    [[{ producto_id: 'A', stock_fbm: 5, observed_at: '2026-10-08' }, { producto_id: 'A', stock_fbm: 6, observed_at: '2026-10-08' }], null],
  ]) {
    const { repo } = reader(data, error); const r = await repo.findPublishedCatalogFbm(['A']);
    assert.equal(r.get('A').quantity, null); assert.equal(r.get('A').status, 'UNAVAILABLE');
  }
});
test('catalog enrichment happens after search/pagination and does not alter stock/FBA formulas', async () => {
  const queried = [];
  const rows = [{ id: 'A', stockFba: 17, stockFbm: 90, stockTotal: 107 }, { id: 'B', stockFba: 2, stockFbm: 3, stockTotal: 5 }];
  const service = compile('modules/products/services/getProductCatalog.ts', {
    '../repositories/productCatalogRepository': { findProductCatalogRows: async () => rows, findProductCatalogSearchExtras: async () => new Map() },
    '../repositories/productCatalogOptionsRepository': { findProductCatalogFilterOptions: async () => ({}) },
    '../mappers/productCatalogMapper': { mapProductCatalogRow: x => x },
    '../utils/productCatalogSearch': { matchesProductCatalogSearch: (_q, row) => row.id === 'A' },
    '../repositories/productCatalogFbmRepository': { findPublishedCatalogFbm: async ids => { queried.push(ids); return new Map([['A', { quantity: 8, observedAt: '2026-10-08', status: 'PUBLISHED' }]]); }, noPublishedFbm: () => ({ quantity: null, status: 'NO_SNAPSHOT' }) },
  });
  const response = await service.getProductCatalog({ q: 'A', limit: 1, offset: 0 });
  assert.deepEqual(queried, [['A']]); assert.equal(response.rows.length, 1); assert.equal(response.pagination.hasMore, false);
  assert.equal(response.rows[0].stockFba, 17); assert.equal(response.rows[0].stockTotal, 107);
  assert.equal(response.rows[0].publishedFbm.quantity, 8);
});
test('desktop/mobile FBM presentation reads published data only, includes observation date', () => {
  const { ProductCatalogFbmStock } = compile('modules/products/components/ProductCatalogFbmStock.tsx', {});
  const { renderToStaticMarkup } = require('react-dom/server');
  const valid = renderToStaticMarkup(ProductCatalogFbmStock({ stock: { quantity: 8, observedAt: '2026-10-08T00:00:00Z', status: 'PUBLISHED' } }));
  assert.match(valid, /FBM 8/); assert.match(valid, /0?8\/10/);
  assert.match(renderToStaticMarkup(ProductCatalogFbmStock({})), /FBM —/);
  const rowSource = read('modules/products/components/ProductCatalogRow.tsx');
  assert.equal((rowSource.match(/stock=\{row.publishedFbm\}/g) ?? []).length, 2);
  assert.doesNotMatch(rowSource, /row.stockFbm/);
  const repoSource = read('modules/products/repositories/productCatalogFbmRepository.ts');
  assert.doesNotMatch(repoSource, /spApi|report_jobs|coordinateFbm|\.insert\(|\.update\(/);
});
