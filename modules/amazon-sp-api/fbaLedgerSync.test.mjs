import test from 'node:test';
import assert from 'node:assert/strict';
import {coordinateLedgerSync} from './fbaLedgerSyncCoordinator.ts';
import {initialLedgerState,ledgerRetryAt,ledgerEnabled,ledgerScheduleEnabled} from './fbaLedgerSyncPolicy.ts';
import {handleLedgerRequest} from './fbaLedgerHttp.ts';
import {ledgerUiState} from '../inventory/services/ledgerSyncUi.ts';

function fixture() {
 let now=Date.parse('2026-09-29T12:00:00Z');let stored={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',state:initialLedgerState('2026-09-28',['ATEST'])};
 let creates=0,polls=0,publishes=0;
 const clone=x=>structuredClone(x);
 const deps={now:()=>now,find:async()=>clone(stored),acquire:async job=>{
  if(job.state.revision!==stored.state.revision || stored.state.lease && Date.parse(stored.state.lease.expiresAt)>now)return null;
  stored.state.revision++;stored.state.lease={token:`token-${stored.state.revision}`,expiresAt:new Date(now+120000).toISOString()};return clone(stored);
 },save:async(job,release)=>{
  assert.equal(job.state.revision,stored.state.revision,'revision fenced');assert.equal(job.state.lease.token,stored.state.lease.token);
  if(Date.parse(job.state.lease.expiresAt)<=now)throw new Error('LEDGER_LEASE_LOST');
  job.state.revision++;if(release)job.state.lease=null;stored=clone(job);
 },create:async()=>{creates++;return 'report';},poll:async()=>{polls++;return {status:'DONE',documentId:'doc',createdAt:new Date(now).toISOString()};},
 publish:async(job,checkpoint)=>{publishes++;job.state.manifest={digest:'digest',coverageValid:true,warnings:[]};await checkpoint();
  const receipt={jobId:job.id,documentId:'doc',digest:'digest',rows:3,publishedAt:new Date(now).toISOString()};
  stored.state.receipt=receipt;stored.state.status='COMPLETED';stored.state.lease=null;stored.state.revision++;return receipt;},
 reconcile:async()=>stored.state.receipt,
 errorInfo:e=>({code:e.message,temporary:!!e.temporary,rateLimited:e.status===429,retryAfter:e.retryAfter})};
 return {deps,get:()=>stored,counts:()=>({creates,polls,publishes}),advance:ms=>now+=ms};
}
test('manual and cron concurrency: enqueue does not create; one CREATE and persisted POLL/PUBLISH survive restart',async()=>{
 const f=fixture();assert.equal((await coordinateLedgerSync({enqueueOnly:true},f.deps)).status,'PENDING');assert.equal(f.counts().creates,0);
 await Promise.all([coordinateLedgerSync({},f.deps),coordinateLedgerSync({},f.deps)]);assert.equal(f.counts().creates,1);assert.equal(f.get().state.phase,'POLL');
 f.advance(16000);await coordinateLedgerSync({},f.deps);assert.equal(f.get().state.phase,'PUBLISH');assert.equal(f.counts().publishes,0);
 const done=await coordinateLedgerSync({},f.deps);assert.equal(done.status,'COMPLETED');assert.equal(done.rows,3);
 await coordinateLedgerSync({},f.deps);assert.equal(f.counts().publishes,1);
 assert.equal('raw' in done,false);assert.equal('documentId' in done,false);
});
test('CREATE_UNCERTAIN after lost response or process death never creates twice',async()=>{
 const f=fixture();let calls=0;f.deps.create=async()=>{calls++;throw new Error('connection lost');};
 assert.equal((await coordinateLedgerSync({},f.deps)).status,'CREATE_UNCERTAIN');
 await coordinateLedgerSync({},f.deps);assert.equal(calls,1);
 const g=fixture();g.get().state.createIntentAt=new Date().toISOString();await coordinateLedgerSync({},g.deps);assert.equal(g.get().state.status,'CREATE_UNCERTAIN');assert.equal(g.counts().creates,0);
});
test('429 resets only confirmed rejected CREATE; persistent Retry-After and POLL 503 backoff',async()=>{
 const f=fixture();f.deps.create=async()=>{throw Object.assign(new Error('429'),{status:429,retryAfter:'600'});};
 await coordinateLedgerSync({},f.deps);assert.equal(f.get().state.status,'RATE_LIMITED');assert.equal(f.get().state.createIntentAt,null);
 assert.ok(Date.parse(f.get().state.nextAttemptAt)-f.deps.now()>=600000);
 const g=fixture();await coordinateLedgerSync({},g.deps);g.advance(16000);g.deps.poll=async()=>{throw Object.assign(new Error('503'),{temporary:true});};
 await coordinateLedgerSync({},g.deps);assert.equal(g.get().state.phase,'POLL');assert.ok(g.get().state.nextAttemptAt);
 assert.equal(ledgerRetryAt(0,1,'Thu, 01 Jan 1970 01:00:00 GMT'),'1970-01-01T01:00:00.000Z');
});
test('expired lease can be acquired; stale worker cannot save; lost commit response reconciles',async()=>{
 const f=fixture();const stale=await f.deps.acquire(structuredClone(f.get()));f.advance(120001);
 await coordinateLedgerSync({},f.deps);await assert.rejects(f.deps.save(stale));
 f.advance(16000);await coordinateLedgerSync({},f.deps);
 const publish=f.deps.publish;f.deps.publish=async(...args)=>{await publish(...args);throw new Error('response lost');};
 assert.equal((await coordinateLedgerSync({},f.deps)).status,'COMPLETED');assert.equal(f.counts().publishes,1);
});
test('authenticated manual allowed, anonymous rejected, GET never advances and UI 202 to COMPLETED',async()=>{
 const f=fixture();let authenticated=false;
 const deps={authenticated:async()=>authenticated,enabled:()=>true,observe:async()=>({status:f.get().state.status,phase:f.get().state.phase}),enqueue:()=>coordinateLedgerSync({enqueueOnly:true},f.deps)};
 const req=method=>new Request('https://local/api/ledger',{method,...(method==='POST'?{body:'{}'}:{})});
 assert.equal((await handleLedgerRequest(req('POST'),deps)).status,401);authenticated=true;
 const response=await handleLedgerRequest(req('POST'),deps);assert.equal(response.status,202);assert.equal(ledgerUiState(await response.json()).pending,true);
 await handleLedgerRequest(req('GET'),deps);assert.equal(f.counts().creates,0);
 assert.equal(ledgerUiState({status:'COMPLETED',publishedAt:'2026-09-29'}).label,'Actualizado: 2026-09-29');
 assert.equal(ledgerEnabled({}),false);assert.equal(ledgerScheduleEnabled({AMAZON_LEDGER_SYNC_ENABLED:'true'}),false);
});
