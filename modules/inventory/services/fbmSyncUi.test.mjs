import test from 'node:test';
import assert from 'node:assert/strict';
import { fbmSyncMessage } from './fbmSyncUi.ts';

test('UI distinguishes pending, processing, rate limits, completion and failure', () => {
  const messages = ['PENDING', 'PROCESSING', 'RATE_LIMITED', 'COMPLETED', 'FAILED'].map(status => fbmSyncMessage({ status, phase: 'POLL', rowsCommitted: 4 }));
  assert.equal(new Set(messages).size, 5);
  assert.match(messages[4], /no se completó/); assert.match(messages[2], /limitado/);
  assert.match(fbmSyncMessage({ status: 'FAILED', error: 'FBM_IDENTITY_UNIVERSE_CHANGED' }), /no reconciliable/);
  assert.match(fbmSyncMessage({ status: 'PROCESSING', phase: 'PUBLISH' }), /publicación pendiente/);
});
