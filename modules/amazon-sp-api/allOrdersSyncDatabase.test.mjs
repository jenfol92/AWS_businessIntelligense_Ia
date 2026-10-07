import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { buildOrdersState } from './allOrdersSyncPolicy.ts';
import { parseAllOrdersRows } from './allOrdersReportParser.ts';
import { PGlite } from '@electric-sql/pglite';
const state=()=>buildOrdersState('2026-07-01','2026-07-02',['A1RKKUPIHCS9HS'],new Date('2026-08-01'));
const base={'amazon-order-id':'o1',sku:'123',asin:'B012345678','purchase-date':'2026-07-01T12:00Z',quantity:'1','fulfillment-channel':'Amazon','sales-channel':'Amazon.es','order-status':'Pending','item-status':'Pending'};
const begin=async(db,s)=>(await db.query('select begin_amazon_orders_operation($1) id',[JSON.stringify(s)])).rows[0].id;
const lease=(db,id,token)=>db.query('select lease_amazon_orders_operation($1,$2) state',[id,token]);
const save=(db,id,token,s,rows=[])=>db.query('select save_amazon_orders_operation($1,$2,$3,$4)',[id,token,JSON.stringify(s),JSON.stringify(rows)]);
const release=(db,id,token)=>db.query('select release_amazon_orders_operation($1,$2)',[id,token]);
function row(status='Pending',q='1',date='2026-08-01T00:00Z') {return {...parseAllOrdersRows([{...base,quantity:q,'order-status':status,'item-status':status,'last-updated-date':date}]).rows[0],identity_resolution:{status:'UNRESOLVED'},report_observed_at:date};}
test('isolated PostgreSQL: atomic import, coverage, leases, replay and status changes',async t=>{
 const db=new PGlite();try{
  await db.exec('create role anon;create role authenticated;create role service_role;create table productos(id uuid primary key);');
  await db.exec(await readFile('sql/migrations/amazon_spapi_report_jobs.sql','utf8'));
  await db.exec(await readFile('sql/migrations/20260928_01_amazon_order_items.sql','utf8'));
  await db.exec(await readFile('sql/migrations/20261007_01_amazon_orders_canonical.sql','utf8'));
  await t.test('prepared migration is locally repeatable',async()=>{await db.exec(await readFile('sql/migrations/20261007_01_amazon_orders_canonical.sql','utf8'))});
  const s=state(), id=await begin(db,s), token=randomUUID();
  await t.test('legacy FBA job never blocks dedicated orders',async()=>{await db.query("insert into amazon_spapi_report_jobs(report_type,source,status) values('GET_LEDGER_SUMMARY_VIEW_DATA','fba_legacy','IN_PROGRESS')");assert.equal(await begin(db,s),id)});
  await t.test('same range resumes, different range rejected atomically',async()=>{assert.equal(await begin(db,s),id);await assert.rejects(begin(db,{...s,toDate:'2026-07-03'}),/RANGE_CONFLICT/);assert.equal((await db.query('select count(*) n from amazon_orders_operations')).rows[0].n,1)});
  await t.test('lease fences concurrent worker and incorrect token',async()=>{assert.ok((await lease(db,id,token)).rows[0].state);assert.equal((await lease(db,id,randomUUID())).rows[0].state,null);await assert.rejects(save(db,id,randomUUID(),s),/LEASE_LOST/)});
  await t.test('requested temporal manifest cannot change while leased',async()=>{const changed=structuredClone(s);changed.windows[0].dataEndTime='2026-07-01';await assert.rejects(save(db,id,token,changed),/MANIFEST_CHANGED/)});
  await t.test('late foreign-key error rolls back rows AND coverage',async()=>{const done=structuredClone(s);Object.assign(done.windows[0],{phase:'COMPLETE',reportId:'r1',documentId:'d1',completedAt:'2026-08-01',rowsUpserted:2});await assert.rejects(save(db,id,token,done,[row(),{...row(),row_fingerprint:'second',producto_id:randomUUID()}]),/foreign key/);assert.equal((await db.query('select count(*) n from amazon_order_items')).rows[0].n,0);assert.equal((await db.query('select status from amazon_orders_coverage')).rows[0].status,'IN_PROGRESS')});
  await t.test('same report twice gives one stored row',async()=>{await save(db,id,token,s,[row()]);await save(db,id,token,s,[row()]);assert.equal((await db.query('select count(*) n from amazon_order_items')).rows[0].n,1);assert.equal((await db.query('select quantity from amazon_order_items')).rows[0].quantity,1)});
  await t.test('Pending to Shipped to Cancelled; quantity zero, stale report cannot regress',async()=>{await save(db,id,token,s,[row('Shipped','2','2026-08-02')]);assert.equal((await db.query('select order_status from amazon_order_items')).rows[0].order_status,'Shipped');await save(db,id,token,s,[row('Cancelled','0','2026-08-03')]);await save(db,id,token,s,[row('Pending','1','2026-08-01')]);const r=(await db.query('select * from amazon_order_items')).rows[0];assert.equal(r.order_status,'Cancelled');assert.equal(r.quantity,0)});
  await t.test('expired lease prevents import',async()=>{await db.query("update amazon_orders_operations set lease_expires_at='2000-01-01' where job_id=$1",[id]);await assert.rejects(save(db,id,token,s),/LEASE_LOST/);await lease(db,id,token)});
  await t.test('complete zero-sales report proves coverage without rows',async()=>{Object.assign(s.windows[0],{phase:'COMPLETE',reportId:'r1',documentId:'d1',completedAt:'2026-08-01',rowsUpserted:0});await save(db,id,token,s,[]);const c=(await db.query('select * from amazon_orders_coverage')).rows[0];assert.equal(c.status,'COMPLETE');assert.equal(c.rows_committed,0);assert.equal((await db.query('select status from amazon_orders_operations')).rows[0].status,'COMPLETED')});
  await t.test('lost success response cannot overwrite COMPLETED as FAILED',async()=>{const failed=structuredClone(s);failed.windows[0].phase='FAILED';failed.error='lost response';await assert.rejects(save(db,id,token,failed),/TERMINAL/);assert.equal((await db.query('select status from amazon_orders_operations')).rows[0].status,'COMPLETED')});
  await release(db,id,token);
  await t.test('completed operation never leased again; new generation permitted',async()=>{assert.equal((await lease(db,id,token)).rows[0].state,null);assert.notEqual(await begin(db,state()),id)});
  await t.test('grants deny PUBLIC execution and application roles table access',async()=>{assert.equal((await db.query("select has_function_privilege('anon','begin_amazon_orders_operation(jsonb)','execute') p")).rows[0].p,false);assert.equal((await db.query("select has_table_privilege('authenticated','amazon_orders_coverage','select') p")).rows[0].p,false)});
  await t.test('partial current-day report never creates COMPLETE coverage',async()=>{await db.exec("update amazon_orders_operations set status='FAILED' where status='PENDING'");const partial=buildOrdersState('2026-08-01','2026-08-01',['A1RKKUPIHCS9HS'],new Date('2026-08-01T12:00Z'));const partialId=await begin(db,partial),partialToken=randomUUID();await lease(db,partialId,partialToken);Object.assign(partial.windows[0],{phase:'COMPLETE',reportId:'r-partial',documentId:'d-partial',completedAt:'2026-08-01',rowsUpserted:0});await save(db,partialId,partialToken,partial);assert.equal((await db.query('select status from amazon_orders_coverage where job_id=$1',[partialId])).rows[0].status,'PARTIAL')});
 }finally{await db.close()}
});
