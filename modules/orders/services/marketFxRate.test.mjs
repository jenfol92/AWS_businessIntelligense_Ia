import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseEcbDailyXml } from '../../finance/services/ecbFxService.ts';
import { marketFxFromEcbTable, normalizeOrderCurrency } from './marketFxRate.ts';

globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN_IN_FX_TESTS'); };
const require = createRequire(import.meta.url), ts = require('typescript');
const XML = `<Cube time='2026-10-06'><Cube currency='USD' rate='1.0921'/><Cube currency='CNY' rate='7.8215'/><Cube currency='GBP' rate='0.8412'/></Cube>`;
const table = parseEcbDailyXml(XML, '2026-10-06T16:00:00Z');

test('CNY y USD devuelven 1 EUR = X moneda exactamente como publica el BCE', () => {
  assert.deepEqual(marketFxFromEcbTable(table, 'CNY'), { currency: 'CNY', foreignPerEur: 7.8215, referenceDate: '2026-10-06', source: 'ECB' });
  assert.equal(marketFxFromEcbTable(table, 'USD').foreignPerEur, 1.0921);
  assert.equal(marketFxFromEcbTable(table, 'GBP').foreignPerEur, 0.8412);
});

test('moneda no publicada devuelve null, sin inventar un tipo', () => {
  assert.equal(marketFxFromEcbTable(table, 'HKD'), null);
});

test('solo se aceptan las monedas del formulario de orden', () => {
  assert.equal(normalizeOrderCurrency(' cny '), 'CNY');
  assert.equal(normalizeOrderCurrency('JPY'), null);
  assert.equal(normalizeOrderCurrency(null), null);
});

function loadRoute(deps) {
  const mod = { exports: {} };
  const js = ts.transpileModule(readFileSync('app/api/orders/fx-rate/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', js)(name => { if (name in deps) return deps[name]; throw Error('Unexpected dependency: ' + name); }, mod, mod.exports);
  return mod.exports;
}
const response = { NextResponse: { json: (body, opts) => ({ body, status: opts?.status ?? 200 }) } };
const route = ({ user = { id: 'u' }, ecb = async () => table } = {}) => loadRoute({
  'next/server': response,
  '@/modules/finance/services/ecbFxService': { getLatestEcbFxTable: ecb },
  '@/modules/orders/services/marketFxRate': { marketFxFromEcbTable, normalizeOrderCurrency },
  '@/server/supabase/routeClient': { createSupabaseRouteClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
});
const req = currency => new Request(`https://local.test/api/orders/fx-rate?currency=${currency}`);

test('ruta: sin sesión rechaza y no consulta el BCE', async () => {
  let calls = 0;
  const r = await route({ user: null, ecb: async () => { calls++; return table; } }).GET(req('CNY'));
  assert.equal(r.status, 401); assert.equal(calls, 0);
});

test('ruta: CNY devuelve el tipo del BCE; EUR es 1 sin red', async () => {
  const r = await route().GET(req('CNY'));
  assert.equal(r.status, 200); assert.equal(r.body.rate.foreignPerEur, 7.8215);
  let calls = 0;
  const eur = await route({ ecb: async () => { calls++; return table; } }).GET(req('EUR'));
  assert.equal(eur.body.rate.foreignPerEur, 1); assert.equal(calls, 0);
});

test('ruta: BCE caído responde 503 (el usuario lo introduce a mano)', async () => {
  const r = await route({ ecb: async () => { throw new Error('ECB_FX_HTTP_500'); } }).GET(req('USD'));
  assert.equal(r.status, 503); assert.equal(r.body.ok, false);
});

test('ruta: moneda no soportada responde 400', async () => {
  assert.equal((await route().GET(req('JPY'))).status, 400);
});
