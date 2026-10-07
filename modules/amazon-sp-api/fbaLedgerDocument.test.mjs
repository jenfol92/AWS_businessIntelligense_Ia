import test from 'node:test';import assert from 'node:assert/strict';import {gzipSync} from 'node:zlib';
import {downloadLedgerDocument} from './fbaLedgerDocument.ts';import {LEDGER_MAX_BYTES} from '../imports/amazon-fba-ledger-summary/strictLedgerDocument.ts';
const doc={reportDocumentId:'doc',url:'https://test.amazonaws.com/doc'};
test('bounded download, gzip expansion, signal, malformed encoding and no signed URL errors',async()=>{
 assert.equal(await downloadLedgerDocument(doc,AbortSignal.timeout(1000),async()=>new Response('ok')),'ok');
 await assert.rejects(downloadLedgerDocument(doc,AbortSignal.timeout(1000),async()=>new Response('x'.repeat(LEDGER_MAX_BYTES+1))),/TOO_LARGE/);
 await assert.rejects(downloadLedgerDocument({...doc,compressionAlgorithm:'GZIP'},AbortSignal.timeout(1000),async()=>new Response(gzipSync('x'.repeat(LEDGER_MAX_BYTES+1)))),/TOO_LARGE/);
 await assert.rejects(downloadLedgerDocument(doc,AbortSignal.abort(),async()=>new Response('ok')));
 await assert.rejects(downloadLedgerDocument(doc,AbortSignal.timeout(1000),async()=>new Response(new Uint8Array([0xff]))),/ENCODING/);
 await assert.rejects(downloadLedgerDocument({...doc,url:'https://evil.test/?secret=foo'},AbortSignal.timeout(1000)),e=>!e.message.includes('foo'));
});
