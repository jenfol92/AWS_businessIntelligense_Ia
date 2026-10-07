import test from 'node:test';
import assert from 'node:assert/strict';
import { splitInclusiveDateRange, isUtcDateOnly, retryAt } from './fbaSalesSyncPolicy.ts';
import { advanceFbaSalesSync, FBA_SALES_REPORT_TYPE } from './fbaSalesSyncWorker.ts';
import { downloadBoundedReportDocument } from './boundedReportDocument.ts';

for (const days of [1,7,30,31,60,90,91,120,365]) test(`inclusive chunk coverage ${days}`, () => {
  const end = new Date(Date.UTC(2026,0,1)+ (days-1)*86400000).toISOString().slice(0,10);
  const ranges=splitInclusiveDateRange('2026-01-01',end);
  assert.equal(ranges.length,Math.ceil(days/30));
  assert.equal(ranges.reduce((sum,r)=>sum+(Date.parse(r.toDate)-Date.parse(r.fromDate))/86400000+1,0),days);
  for(let i=1;i<ranges.length;i++) assert.equal(Date.parse(ranges[i].fromDate)-Date.parse(ranges[i-1].toDate),86400000);
});
test('year, leap February, DST and audited range',()=>{
  assert.equal(splitInclusiveDateRange('2023-12-31','2024-02-29').length,3);
  assert.equal(splitInclusiveDateRange('2026-03-15','2026-04-13').length,1);
  assert.deepEqual(splitInclusiveDateRange('2026-06-24','2026-09-21'),[
    {fromDate:'2026-06-24',toDate:'2026-07-23'},{fromDate:'2026-07-24',toDate:'2026-08-22'},{fromDate:'2026-08-23',toDate:'2026-09-21'}]);
});
test('impossible dates rejected',()=>{
  for(const date of ['2026-02-30','2026-13-01','2025-02-29','0000-01-01','2026-1-01']) assert.equal(isUtcDateOnly(date),false);
  assert.equal(isUtcDateOnly('2024-02-29'),true);
  assert.throws(()=>splitInclusiveDateRange('2026-02-30','2026-03-01'));
});
function fixture(days=1) {
  let now=Date.parse('2026-09-22T00:00:00Z'), saved, creates=0,publishes=0;
  const state={version:1,fromDate:'2026-01-01',toDate:days===1?'2026-01-01':'2026-01-31',mode:'import',marketplaceIds:['ES'],tipoCliente:'B2C',status:'PENDING',chunkIndex:0,nextAttemptAt:null,error:null,lastCommittedAt:null};
  state.chunks=splitInclusiveDateRange(state.fromDate,state.toDate).map(r=>({...r,phase:'CREATE',attempts:0}));
  const deps={now:()=>now,save:async s=>{saved=structuredClone(s)},create:async()=>{creates++;return '123'},poll:async()=>({reportType:FBA_SALES_REPORT_TYPE,processingStatus:'DONE',reportDocumentId:'doc',dataStartTime:'2026-01-01T00:00:00Z',dataEndTime:'2026-01-01T23:59:59Z'}),publish:async(c,s)=>{publishes++;saved=structuredClone(s)},errorInfo:e=>({rateLimited:e.status===429,retryAfter:e.retryAfter,message:e.message})};
  return {state,deps,tick:()=>{now+=3600000},counts:()=>({creates,publishes}),saved:()=>saved};
}
for(const [amazon,status] of [['IN_QUEUE','PENDING'],['IN_PROGRESS','PROCESSING'],['FATAL','FATAL'],['CANCELLED','FAILED']]) test(amazon,async()=>{
  const f=fixture();let s=await advanceFbaSalesSync(f.state,f.deps);f.tick();const poll=f.deps.poll;f.deps.poll=async()=>({...await poll(),processingStatus:amazon});
  s=await advanceFbaSalesSync(s,f.deps);assert.equal(s.status,status);assert.equal(f.counts().publishes,0);assert.equal(s.chunks[0].reportId,'123');
});
test('resume, report reuse and COMPLETED only after publication; repeat completed range',async()=>{
  const f=fixture();let s=await advanceFbaSalesSync(f.state,f.deps);f.tick();s=await advanceFbaSalesSync(s,f.deps);
  assert.equal(s.status,'PROCESSING');s=await advanceFbaSalesSync(s,f.deps);assert.equal(s.status,'COMPLETED');
  await advanceFbaSalesSync(s,f.deps);assert.deepEqual(f.counts(),{creates:1,publishes:1});assert.ok(s.lastCommittedAt);
});
test('429 preserves report and obeys Retry-After',async()=>{
  const f=fixture();let s=await advanceFbaSalesSync(f.state,f.deps);f.tick();const poll=f.deps.poll;
  f.deps.poll=async()=>{throw Object.assign(new Error('throttle'),{status:429,retryAfter:'7200'})};
  s=await advanceFbaSalesSync(s,f.deps);assert.equal(s.status,'RATE_LIMITED');assert.equal(s.chunks[0].reportId,'123');
  f.deps.poll=poll;f.tick();assert.equal((await advanceFbaSalesSync(s,f.deps)).status,'RATE_LIMITED');f.tick();s=await advanceFbaSalesSync(s,f.deps);assert.equal(s.chunks[0].phase,'DOWNLOAD');assert.equal(f.counts().creates,1);
  assert.equal(retryAt('Tue, 22 Sep 2026 04:00:00 GMT',1,Date.parse('2026-09-22T00:00:00Z')),'2026-09-22T04:00:00.000Z');
});
test('second chunk failure retains first commit',async()=>{
  const f=fixture(31);const poll=f.deps.poll;f.deps.poll=async()=>({...await poll(),dataEndTime:'2026-01-30T23:59:59Z'});let s=f.state;for(let i=0;i<3;i++){s=await advanceFbaSalesSync(s,f.deps);f.tick()}
  f.deps.create=async()=>{throw new Error('failure')};s=await advanceFbaSalesSync(s,f.deps);
  assert.equal(s.status,'FAILED');assert.equal(s.chunkIndex,1);assert.ok(s.lastCommittedAt);assert.equal(f.counts().publishes,1);
});
for(const error of ['marketplace missing','canonicalization failed','LEASE_LOST']) test(error+' cannot complete',async()=>{
  const f=fixture();let s=await advanceFbaSalesSync(f.state,f.deps);f.tick();s=await advanceFbaSalesSync(s,f.deps);
  f.deps.publish=async()=>{throw new Error(error)};s=await advanceFbaSalesSync(s,f.deps);assert.equal(s.status,'FAILED');assert.equal(s.lastCommittedAt,null);
});
test('unknown create outcome never recreates and retry budget terminates',async()=>{
  const f=fixture();f.state.chunks[0].phase='CREATE_INTENT';let s=await advanceFbaSalesSync(f.state,f.deps);assert.equal(s.status,'FAILED');assert.equal(f.counts().creates,0);
  f.state.chunks[0].phase='POLL';f.state.chunks[0].attempts=48;s=await advanceFbaSalesSync(f.state,f.deps);assert.equal(s.error,'ATTEMPT_LIMIT_REACHED');
});
test('create 429 schedules a bounded retry; download 429 keeps report and document IDs',async()=>{
 const f=fixture();const create=f.deps.create;
 f.deps.create=async()=>{throw Object.assign(new Error('create throttled'),{status:429,retryAfter:'120'})};
 let s=await advanceFbaSalesSync(f.state,f.deps);assert.equal(s.status,'RATE_LIMITED');assert.equal(s.chunks[0].phase,'CREATE');
 f.tick();f.deps.create=create;s=await advanceFbaSalesSync(s,f.deps);f.tick();s=await advanceFbaSalesSync(s,f.deps);
 f.deps.publish=async()=>{throw Object.assign(new Error('document throttled'),{status:429,retryAfter:'120'})};
 s=await advanceFbaSalesSync(s,f.deps);assert.equal(s.status,'RATE_LIMITED');assert.equal(s.chunks[0].reportId,'123');assert.equal(s.chunks[0].documentId,'doc');assert.equal(s.chunks[0].phase,'DOWNLOAD');assert.equal(f.counts().creates,1);
});
test('bounded document downloader preserves HTTP 429 and Retry-After without fetching Amazon',async()=>{
 await assert.rejects(downloadBoundedReportDocument({url:'https://fake.amazonaws.com/document'},{signal:AbortSignal.timeout(1000),maxBytes:100,
 fetchDocument:async()=>new Response('',{status:429,headers:{'Retry-After':'180'}})}),error=>error.status===429&&error.details.headers['retry-after']==='180');
});
test('existing report with a different declared range cannot publish',async()=>{
 const f=fixture();let s=await advanceFbaSalesSync(f.state,f.deps);f.tick();
 f.deps.poll=async()=>({reportType:FBA_SALES_REPORT_TYPE,processingStatus:'DONE',reportDocumentId:'doc',dataStartTime:'2020-01-01T00:00:00Z'});
 s=await advanceFbaSalesSync(s,f.deps);assert.equal(s.status,'FAILED');assert.equal(s.error,'REPORT_RANGE_MISMATCH');assert.equal(f.counts().publishes,0);
});
for (const dates of [
 {}, {dataStartTime:'2026-01-01T00:00:00Z'},
 {dataStartTime:'2026-01-01T12:00:00Z',dataEndTime:'2026-01-01T23:59:59Z'},
 {dataStartTime:'2026-01-01T00:00:00Z',dataEndTime:'2026-01-01T12:00:00Z'},
]) test('missing or partial report range fails closed '+JSON.stringify(dates),async()=>{
 const f=fixture();let s=await advanceFbaSalesSync(f.state,f.deps);f.tick();
 f.deps.poll=async()=>({reportType:FBA_SALES_REPORT_TYPE,processingStatus:'DONE',reportDocumentId:'doc',...dates});
 s=await advanceFbaSalesSync(s,f.deps);assert.equal(s.error,'REPORT_RANGE_MISMATCH');assert.equal(f.counts().publishes,0);
});
test('equivalent UTC timestamps accepted',async()=>{
 const f=fixture();let s=await advanceFbaSalesSync(f.state,f.deps);f.tick();const poll=f.deps.poll;
 f.deps.poll=async()=>({...await poll(),dataStartTime:'2026-01-01T01:00:00+01:00',dataEndTime:'2026-01-01T23:59:59.000Z'});
 s=await advanceFbaSalesSync(s,f.deps);assert.equal(s.chunks[0].phase,'DOWNLOAD');
});
for(const start of ['2023-12-15','2024-02-01','2026-03-15','2026-10-15']) {
 for(const days of [1,7,30,31,60,90,91,120,365]) test(`every UTC day exactly once ${start} ${days}`,()=>{
  const dates=Array.from({length:days},(_,i)=>new Date(Date.parse(start+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
  const chunks=splitInclusiveDateRange(start,dates.at(-1));const actual=[];
  for(const c of chunks) {
   const n=(Date.parse(c.toDate)-Date.parse(c.fromDate))/86400000+1;assert.ok(n>=1&&n<=30);
   for(let i=0;i<n;i++)actual.push(new Date(Date.parse(c.fromDate+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
  }
  assert.deepEqual(actual,dates);assert.equal(new Set(actual).size,days);
 });
}
