import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFbmProductIdentities } from './fbmProductIdentityRepository.ts';
import { fbmIdentityKey, reconcileFbmIdentities } from './fbmIdentityReconciliation.ts';

globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
const product = (id, sku = 'sku-' + id, estado = 'activo') => ({ id, sku, estado, asin: 'B012345678' });
const initial = ['A', 'B', 'C'].map(id => product(id));
const key = fbmIdentityKey(buildFbmProductIdentities(initial));
test('discontinued product is an explicit removal; no zero quantity is fabricated', () => {
  const r = reconcileFbmIdentities(key, [product('A'), product('B'), product('C', 'sku-C', 'descatalogado')]);
  assert.equal(r.ok, true); assert.deepEqual(r.identities.map(i => i.productoId), ['A', 'B']);
  assert.deepEqual(r.diagnostics.removedBecauseDiscontinued, [['C', 'sku-C']]);
  assert.equal(r.diagnostics.expectedCount, 3); assert.equal(r.diagnostics.currentCount, 2);
});
for (const [label, products, group] of [
  ['addition', [...initial, product('D')], 'unexpectedAdded'],
  ['sku change', [product('A', 'new-sku'), product('B'), product('C')], 'skuChanged'],
  ['missing record', initial.slice(0, 2), 'unexpectedRemoved'],
  ['non-business inactive state', [product('A'), product('B'), product('C', 'sku-C', 'borrador')], 'unexpectedRemoved'],
  ['duplicate sku', [product('A'), product('B', 'sku-A'), product('C')], 'duplicateIdentity'],
  ['duplicate product', [...initial, product('A')], 'duplicateIdentity'],
  ['invalid expected product', [product('A'), product('B'), { ...product('C'), asin: null }], 'invalidIdentity'],
  ['discontinued but SKU changed', [product('A'), product('B'), product('C', 'other', 'descatalogado')], 'skuChanged'],
  ['discontinued but invalid identity', [product('A'), product('B'), { ...product('C', 'sku-C', 'descatalogado'), asin: null }], 'invalidIdentity'],
]) test(label + ' blocks publication', () => {
  const r = reconcileFbmIdentities(key, products); assert.equal(r.ok, false); assert.ok(r.diagnostics[group].length);
});
test('malformed and duplicate frozen identities block', () => {
  for (const value of [null, '{}', '[]', '[["A","sku-A"],["A","sku-A"]]']) assert.equal(reconcileFbmIdentities(value, initial).ok, false);
});
test('all operational products discontinued does not publish an empty run', () => {
  assert.equal(reconcileFbmIdentities(key, initial.map(p => ({ ...p, estado: 'descatalogado' }))).ok, false);
});
test('existing pair serialization remains compatible; unrelated drafts do not become operational', () => {
  const r = reconcileFbmIdentities(key, [...initial, product('draft', 'draft', 'borrador')]);
  assert.equal(r.ok, true); assert.equal(fbmIdentityKey(r.identities), key);
});
