// PostgreSQL integration tests in isolated memory. Never reads DATABASE_URL or connects remotely.
// Uses the project devDependency @electric-sql/pglite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readPublishedAmazonObservation,amazonObservationFilter} from './amazonObservationRun.ts';
import {groupObservation} from './amazonTreasuryGroupObservation.ts';
import {buildDeferredTreasuryObservation} from './amazonTreasuryDeferredFields.ts';
import {aggregateDeferredByReleaseDate} from './amazonDeferredReleaseAggregates.ts';
import { PGlite } from '@electric-sql/pglite';
const read=name=>readFile(new URL('../../../sql/migrations/'+name,import.meta.url),'utf8');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const legacyAt='2026-09-15T10:00:00Z';
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create function auth.role() returns text language sql as $$select 'service_role'::text$$;
 create table public.finance_amazon_income_forecasts(id uuid primary key);`);
 const snapshots=await read('20260811_06_amazon_treasury_cash_forecast.sql');
 await db.exec(snapshots.slice(snapshots.indexOf('create table')));
 const sync=await read('20260811_03_amazon_financial_planning_automation.sql');
 await db.exec(sync.slice(sync.indexOf('create table'),sync.indexOf('alter table public.finance_amazon_sync_state')));
 const original=await read('20260812_01_amazon_treasury_observational_snapshots.sql');
 await db.exec(original.slice(0,original.indexOf('create or replace function')));
 const fx=await read('20260812_02_amazon_marketplace_external_fx_ecb.sql');
 await db.exec(fx.slice(0,fx.indexOf('create or replace function')));
 await db.exec(await read('20260915_01_amazon_deferred_observation_fields.sql'));
 await db.query(`insert into finance_amazon_treasury_forecast_snapshots(source_key,observation_key,marketplace,economic_state,snapshot_at,original_currency,original_amount,amount_eur,confidence,estimation_method) values('legacy','legacy','ES','AVAILABLE',$1,'EUR',99,99,'medium','legacy')`,[legacyAt]);
 await db.query(`update finance_amazon_sync_state set status='succeeded',last_result=$1 where sync_key='amazon_financial_planning'`,[{observations:{observedAt:legacyAt}}]);
 await db.exec(await read('20260915_02_amazon_observation_sync_runs.sql'));
 return db;
}
async function acquire(db,id){return (await db.query('select finance_try_acquire_amazon_sync($1) as result',[id])).rows[0].result;}
async function state(db){return (await db.query('select * from finance_amazon_sync_state')).rows[0];}
function observations(at){const now=new Date(at),signal=[{marketplaceId:'A1RKKUPIHCS9HS'}];return [
 groupObservation({FinancialEventGroupId:'X',ProcessingStatus:'Open',OriginalTotal:{CurrencyAmount:10,CurrencyCode:'EUR'}},signal,now,[1,3]),
 buildDeferredTreasuryObservation({transactionId:'Y',transactionType:'Shipment',marketplaceDetails:signal[0],totalAmount:{currencyAmount:7,currencyCode:'EUR'},contexts:[{contextType:'DeferredContext',maturityDate:'2026-09-24',deferralReason:'DD7'}]},now),
 groupObservation({FinancialEventGroupId:'Z',ProcessingStatus:'Closed',FundTransferStatus:'Processing',FundTransferDate:'2026-09-15T10:00:00Z',OriginalTotal:{CurrencyAmount:20,CurrencyCode:'EUR'}},signal,now,[1,3]),
 ];}
const parameters=['syncRunId','observationKey','sourceKey','marketplace','economicState','observedAt','originalCurrency','originalAmount','amountEur','officialAmountEur','financialEventGroupId','amazonTransactionId','transactionStatus','settlementProcessingStatus','fundTransferStatus','fundTransferAt','expectedAvailabilityDate','expectedRequestDate','expectedBankDate','confidence','estimationMethod','fxSource','fxObservedAt','fxKind','estimatedFxRate','realizedFxRate','realizedAmountEur','amazonTransactionType','amazonPostedAt','amazonReleaseDate','amazonDeferralReason','source','evidence'];
async function persist(db,id,item){return (await db.query('select (finance_insert_amazon_treasury_observation('+parameters.map((_,i)=>'$'+(i+1)).join(',')+')).*',parameters.map(k=>k==='syncRunId'?id:item[k]??null))).rows[0];}
function result(id,at,items){return {observations:{runId:id,observedAt:new Date(at).toISOString(),written:items.length,available:items.filter(i=>i.economicState==='AVAILABLE').length,deferred:items.filter(i=>i.economicState==='DEFERRED').length,pendingBank:items.filter(i=>i.economicState==='PENDING_BANK').length,errors:[]}};}
async function finish(db,id,ok,res){return db.query('select finance_finish_amazon_sync($1,$2,$3,$4)',[id,ok,res,ok?null:'controlled failure']);}
async function current(db,selection){const filter=amazonObservationFilter(selection??readPublishedAmazonObservation((await state(db)).last_result));if(!filter)return [];return (await db.query(`select * from finance_amazon_treasury_forecast_snapshots where ${filter.column}=$1 ${filter.column==='snapshot_at'?'and sync_run_id is null':''} order by source_key`,[filter.value])).rows;}

test('real PostgreSQL: full runs, retry, immutable history, missing identity, NULL, failed publication and legacy',async t=>{
 const db=await setup();try{
 await t.test('10 legacy fallback before first published run',async()=>{
   assert.equal(readPublishedAmazonObservation((await state(db)).last_result).runId,null);
   assert.deepEqual((await current(db)).map(r=>r.source_key),['legacy']);
 });
 const a=await acquire(db,A),itemsA=observations(a.observedAt);const rowsA=[];
 for(const item of itemsA)rowsA.push(await persist(db,A,item));
 await t.test('1 every state belongs to run A',()=>assert.deepEqual(rowsA.map(r=>r.sync_run_id),[A,A,A]));
 await finish(db,A,true,result(A,a.observedAt,itemsA));
 const b=await acquire(db,B),itemsB=observations(b.observedAt);const rowsB=[];
 for(const item of itemsB)rowsB.push(await persist(db,B,item));
 await t.test('2 same material in B creates new physical rows and keeps A',async()=>{
   assert.deepEqual(itemsA.map(r=>r.observationKey),itemsB.map(r=>r.observationKey));
   assert.ok(rowsA.every((r,i)=>r.id!==rowsB[i].id));assert.equal((await current(db,{runId:A})).length,3);
 });
 await t.test('3 identical retries of B are idempotent',async()=>{
   for(let i=0;i<itemsB.length;i++)assert.equal((await persist(db,B,itemsB[i])).id,rowsB[i].id);
   assert.equal((await current(db,{runId:B})).length,3);
   await assert.rejects(persist(db,B,{...itemsB[0],amountEur:999}),/AMAZON_RUN_OBSERVATION_MISMATCH/);
 });
 await finish(db,B,true,result(B,b.observedAt,itemsB));
 await t.test('5 and 6 unchanged DEFERRED/PENDING_BANK remain in B',async()=>{
   assert.deepEqual((await current(db)).map(r=>r.economic_state).sort(),['AVAILABLE','DEFERRED','PENDING_BANK']);
 });
 await t.test('published run rejects a new identity but allows identical retries',async()=>{
   assert.equal((await persist(db,B,itemsB[0])).id,rowsB[0].id);
   await assert.rejects(persist(db,B,{...itemsB[0],sourceKey:'other',observationKey:'other'}),/AMAZON_SYNC_RUN_NOT_OWNED/);
 });
 const c=await acquire(db,C),itemsC=observations(c.observedAt);await persist(db,C,itemsC[0]);
 await t.test('8 partial C fails coverage and cannot replace B',async()=>{
   await assert.rejects(finish(db,C,true,result(C,c.observedAt,itemsC)),/AMAZON_RUN_COVERAGE_MISMATCH/);
   assert.equal(readPublishedAmazonObservation((await state(db)).last_result).runId,B);
   await finish(db,C,false,result(C,c.observedAt,itemsC));
   assert.equal(readPublishedAmazonObservation((await state(db)).last_result).runId,B);
 });
 await t.test('stable observedAt on reacquisition of same failed run',async()=>{
   const retry=await acquire(db,C);assert.equal(retry.observedAt,c.observedAt);
   for(const item of itemsC)await persist(db,C,item);
   await finish(db,C,true,result(C,c.observedAt,itemsC));
 });
 await t.test('4 identity absent in new run stays only in historical run',async()=>{
   const D='dddddddd-dddd-4ddd-8ddd-dddddddddddd',d=await acquire(db,D),items=observations(d.observedAt).slice(1);
   for(const item of items)await persist(db,D,item);await finish(db,D,true,result(D,d.observedAt,items));
   assert.equal((await current(db)).some(r=>r.source_key==='available:X'),false);
   assert.equal((await current(db,{runId:A})).some(r=>r.source_key==='available:X'),true);
 });
 await t.test('7 NULL EUR persists and aggregate remains incomplete',async()=>{
   const E='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',e=await acquire(db,E);
   const item=buildDeferredTreasuryObservation({transactionId:'unvalued',totalAmount:{currencyAmount:50,currencyCode:'AED'},contexts:[{contextType:'DeferredContext',maturityDate:'2026-09-24'}]},new Date(e.observedAt));
   await persist(db,E,item);await finish(db,E,true,result(E,e.observedAt,[item]));
   const rows=await current(db);assert.equal(rows[0].amount_eur,null);
   const bucket=aggregateDeferredByReleaseDate(rows)[0];assert.equal(bucket.unvaluedCount,1);assert.equal(bucket.isComplete,false);
 });
 await t.test('9 pinned aggregate and lazy detail keep B after later publication',async()=>{
   const pinned=readPublishedAmazonObservation(result(B,b.observedAt,itemsB));
   const run=(await db.query("select id from finance_amazon_observation_runs where id=$1 and status='succeeded'",[pinned.runId])).rows[0];assert.equal(run.id,B);
   const aggregateRows=(await current(db,pinned)).filter(r=>r.economic_state==='DEFERRED');
   const detailFilter=amazonObservationFilter(pinned);const detail=(await db.query(`select * from finance_amazon_treasury_forecast_snapshots where ${detailFilter.column}=$1 and economic_state='DEFERRED'`,[detailFilter.value])).rows;
   assert.deepEqual(detail.map(r=>r.id),aggregateRows.map(r=>r.id));
 });
 await t.test('10 new current never mixes legacy; legacy row is unchanged',async()=>{
   assert.equal((await current(db)).some(r=>r.source_key==='legacy'),false);
   const legacy=(await db.query("select sync_run_id,amount_eur from finance_amazon_treasury_forecast_snapshots where source_key='legacy'")).rows[0];assert.equal(legacy.sync_run_id,null);assert.equal(Number(legacy.amount_eur),99);
 });
 await t.test('RPC grants and overload are restrictive',async()=>{
   const f=(await db.query("select pronargs,has_function_privilege('anon',oid,'EXECUTE') as anon,has_function_privilege('authenticated',oid,'EXECUTE') as authenticated,has_function_privilege('service_role',oid,'EXECUTE') as service from pg_proc where proname='finance_insert_amazon_treasury_observation'")).rows;
   assert.equal(f.length,1);assert.equal(f[0].pronargs,33);assert.equal(f[0].anon,false);assert.equal(f[0].authenticated,false);assert.equal(f[0].service,true);
 });
 }finally{await db.close();}
});
