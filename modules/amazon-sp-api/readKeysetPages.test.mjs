import test from 'node:test';
import assert from 'node:assert/strict';
import { readKeysetPages } from './readKeysetPages.ts';

test('keyset pages traverse more than 50,000 ordered identities once, without gaps', async () => {
  const rows = Array.from({length: 53_217}, (_, n) => ({
    id: `id-${String(n).padStart(6, '0')}`,
    producto_id: `product-${n % 31}`,
    sku_original: `seller-${n}`,
    msku_aliases: [`alias-${n}`],
    asin: `asin-${n}`,
    fnsku: `fnsku-${n}`,
  }));
  const cursors = [];
  const result = await readKeysetPages(async (after, limit) => {
    cursors.push(after);
    return rows.filter(row => after === null || row.id > after).slice(0, limit);
  }, {pageSize: 1000, cursorOf: row => row.id});

  assert.equal(result.length, rows.length);
  assert.equal(new Set(result.map(row => row.id)).size, rows.length);
  assert.deepEqual(result.map(row => row.id), rows.map(row => row.id));
  assert.equal(cursors.length, 54);
  assert.equal(cursors[51], 'id-050999');
});

test('keyset reader rejects a repeated or out-of-order cursor instead of looping or losing rows', async () => {
  await assert.rejects(() => readKeysetPages(async () => [{id: 'b'}, {id: 'a'}], {
    pageSize: 2, cursorOf: row => row.id,
  }), /increase strictly/);
});
