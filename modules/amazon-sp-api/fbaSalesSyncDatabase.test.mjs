// Isolated PostgreSQL only. No environment credentials or network clients are loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const read=name=>readFile(new URL('../../sql/migrations/'+name,import.meta.url),'utf8');
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',P='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
async function database() {
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table productos(id uuid primary key);insert into productos values('${P}');
 create table paises(id uuid primary key default gen_random_uuid(),code text unique,name text,currency text);
 create table amazon_marketplaces(id text primary key,code text unique,name text,currency text,pais_id uuid references paises(id));
 insert into amazon_marketplaces(id,code) values('ES','ES');
 create table ventas_diarias(id uuid primary key,producto_id uuid references productos(id),fecha date,unidades_vendidas integer,
 ingresos_brutos numeric,pais text,canal_venta text,moneda text,tipo_cliente text,marketplace_id text references amazon_marketplaces(id),source text,
 unique(producto_id,fecha,pais,canal_venta,moneda,tipo_cliente,marketplace_id));`);
 await db.exec(await read('amazon_spapi_report_jobs.sql'));
 await db.exec(await read('20260703_amazon_sync_jobs.sql'));
 await db.exec(await read('amazon_report_scheduler_foundation.sql'));
 const raw=await read('20260702_amazon_fba_forecast_spapi_base.sql');
 await db.exec(raw);
 await db.exec(await read('20260709_sync_ventas_diarias_from_amazon_fba_sales.sql'));
 await db.exec(await read('20260710_update_v_amazon_fba_sales_daily_to_amazon_fulfilled_shipments.sql'));
 await db.exec(await read('20260922_01_fba_sales_coordinator.sql'));
 return db;
}
const initial=()=>({version:1,mode:'import',fromDate:'2026-09-01',toDate:'2026-09-01',marketplaceIds:['ES'],tipoCliente:'B2C',status:'PROCESSING',chunkIndex:0,nextAttemptAt:null,error:null,lastCommittedAt:null,chunks:[{fromDate:'2026-09-01',toDate:'2026-09-01',phase:'DOWNLOAD',reportId:'123',documentId:'doc',attempts:3,diagnostic:{reportType:'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL',processingStatus:'DONE',reportDocumentId:'doc',dataStartTime:'2026-09-01T00:00:00Z',dataEndTime:'2026-09-01T23:59:59Z'}}]});
async function job(db,id=A,state=initial(),key=id) {
 await db.query(`insert into amazon_spapi_report_jobs(id,report_type,source,raw) values($1,'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL','fba_sales_coordinator',$2)`,[id,JSON.stringify({requestedCreateReportPayload:{salesCompatibilityKey:key},fbaSalesSync:state})]);
}
async function claim(db,id=A) {return (await db.query('select claim_fba_sales_sync($1,null) as result',[id])).rows[0].result;}
function row(overrides={}) {return {report_id:'123',marketplace_id:'ES',sale_date:'2026-09-01',sku_original:'sku',sku_limpio:'sku',producto_id:P,quantity:3,amount:30,currency:'EUR',ship_to_country:'ES',fulfillment_channel:'FBA',sales_channel:'amazon.es',row_fingerprint:'identity',raw:{report_type:'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'},imported_at:'2026-09-22T00:00:00Z',...overrides};}
async function commit(db,runId,rows=[row()],id=A,markets=['ES']) {return db.query('select commit_fba_sales_chunk($1,$2,$3,$4) as result',[id,runId,JSON.stringify(rows),markets]);}
test('manual + cron share lease, expired lease replacement fences old worker and checkpoint',async()=>{
 const db=await database();try {
 await job(db);const [a,b]=await Promise.all([claim(db),claim(db)]);assert.ok(a.runId);assert.equal(b.runId,null);
 await db.query("update amazon_report_sync_runs set lock_expires_at=now()-interval '1 second' where id=$1",[a.runId]);
 const c=await claim(db);assert.ok(c.runId);assert.notEqual(c.runId,a.runId);
 await assert.rejects(commit(db,a.runId),/LEASE_LOST/);
 await assert.rejects(db.query('select checkpoint_fba_sales_sync($1,$2,$3)',[A,a.runId,JSON.stringify(initial())]),/LEASE_LOST/);
 await commit(db,c.runId);assert.equal((await db.query('select sum(quantity) n from amazon_fba_sales_daily_raw')).rows[0].n,3);
 assert.equal((await claim(db)).state.status,'COMPLETED');
 await assert.rejects(commit(db,c.runId),/INVALID_PUBLICATION_STATE/);
 }finally{await db.close()}
});
test('FIFO prevents an older report publishing after a newer range; active uniqueness',async()=>{
 const db=await database();try{
 await job(db);await job(db,B);assert.equal((await claim(db,B)).runId,null);
 await assert.rejects(job(db,P,initial(),A),/duplicate key/);
 const a=await claim(db);await commit(db,a.runId);
 await db.query("update amazon_report_sync_runs set status='SUCCESS' where id=$1",[a.runId]);
 assert.ok((await claim(db,B)).runId);
 }finally{await db.close()}
});
for(const mode of ['marketplace','canonical']) test(mode+' failure rolls back RAW, sales and checkpoint',async()=>{
 const db=await database();try{
 await job(db);const c=await claim(db);
 if(mode==='canonical') await db.exec("alter table ventas_diarias add constraint test_failure check(unidades_vendidas<0)");
 await assert.rejects(commit(db,c.runId,[row()],A,mode==='marketplace'?['MISSING']:['ES']));
 assert.equal((await db.query('select count(*)::int n from amazon_fba_sales_daily_raw')).rows[0].n,0);
 assert.equal((await claim(db)).state.lastCommittedAt,null);
 }finally{await db.close()}
});
test('syncOnly shares lease, preserves sources and publishes without RAW writes',async()=>{
 const db=await database();try{
 await job(db);let c=await claim(db);await commit(db,c.runId);
 await db.query("update amazon_report_sync_runs set status='SUCCESS' where id=$1",[c.runId]);
 await db.exec("update ventas_diarias set source='manual',unidades_vendidas=8");
 await job(db,B,{...initial(),mode:'syncOnly'});c=await claim(db,B);await commit(db,c.runId,[],B);
 assert.equal((await db.query('select unidades_vendidas n from ventas_diarias')).rows[0].n,8);
 assert.equal((await db.query('select count(*)::int n from amazon_fba_sales_daily_raw')).rows[0].n,1);
 }finally{await db.close()}
});
test('repeat range upserts identity and republishes without duplicating canonical grain',async()=>{
 const db=await database();try{
 await job(db);let c=await claim(db);await commit(db,c.runId);
 await db.query("update amazon_report_sync_runs set status='SUCCESS' where id=$1",[c.runId]);
 await job(db,B);c=await claim(db,B);await commit(db,c.runId,[row({quantity:5})],B);
 assert.equal((await db.query('select count(*)::int n,sum(quantity)::int units from amazon_fba_sales_daily_raw')).rows[0].n,1);
 assert.deepEqual((await db.query('select count(*)::int n,sum(unidades_vendidas)::int units from ventas_diarias')).rows[0],{n:1,units:5});
 }finally{await db.close()}
});
test('lease expiration during canonicalization rolls back entire publication',async()=>{
 const db=await database();try{
 await job(db);const c=await claim(db);
 await db.exec(`create function expire_test_lease() returns trigger language plpgsql as $$begin update amazon_report_sync_runs set lock_expires_at=clock_timestamp()-interval '1 second';return new;end$$;
 create trigger expire_test after insert on ventas_diarias for each row execute function expire_test_lease();`);
 await assert.rejects(commit(db,c.runId),/LEASE_LOST/);
 assert.equal((await db.query('select count(*)::int n from amazon_fba_sales_daily_raw')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from ventas_diarias')).rows[0].n,0);
 }finally{await db.close()}
});
test('ACL disallows legacy unfenced writer and public new RPC execution',async()=>{
 const db=await database();try{
 for(const role of ['anon','authenticated']) {
 const result=await db.query(`select has_function_privilege($1,'public.commit_fba_sales_chunk(uuid,uuid,jsonb,text[])','execute') allowed`,[role]);assert.equal(result.rows[0].allowed,false);
 }
 assert.equal((await db.query("select has_function_privilege('service_role','public.sync_ventas_diarias_from_amazon_fba_sales(date,date,text[],text,text)','execute') allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select has_function_privilege('service_role','public.commit_fba_sales_chunk(uuid,uuid,jsonb,text[])','execute') allowed")).rows[0].allowed,true);
 }finally{await db.close()}
});
test('catalogue idempotent, uses existing countries, refuses conflicting identities or unknown required metadata',async()=>{
 const db=await database();try{
 await db.exec("insert into paises(code,name,currency) select c,c,'EUR' from unnest(array['BE','NL','IE','AE','SA']) c");
 const migration=await read('20260922_02_fba_sales_marketplace_catalog.sql');await db.exec(migration);await db.exec(migration);
 assert.equal((await db.query('select count(*)::int n from amazon_marketplaces where pais_id is not null')).rows[0].n,5);
 await db.exec("update amazon_marketplaces set code='XX' where code='BE'");await assert.rejects(db.exec(migration),/identity conflict/);await db.exec('rollback');
 await db.exec("delete from amazon_marketplaces where code='XX';alter table amazon_marketplaces add column required_metadata text not null default 'existing';alter table amazon_marketplaces alter column required_metadata drop default");
 await assert.rejects(db.exec(migration),/metadata without a repo-defined default/);await db.exec('rollback');
 await db.exec("delete from paises where code='BE'");await assert.rejects(db.exec(migration),/absent or missing id/);await db.exec('rollback');
 }finally{await db.close()}
});
test('final amazon_sync_jobs publication sums chunks and rejects stale checkpoint',async()=>{
 const db=await database();try{
 const state=initial();state.toDate='2026-09-02';state.chunks.push({...structuredClone(state.chunks[0]),fromDate:'2026-09-02',toDate:'2026-09-02',reportId:'456',diagnostic:{...state.chunks[0].diagnostic,dataStartTime:'2026-09-02T00:00:00Z',dataEndTime:'2026-09-02T23:59:59Z'}});
 await job(db,A,state);const c=await claim(db);await commit(db,c.runId);
 assert.equal((await db.query('select count(*)::int n from amazon_sync_jobs')).rows[0].n,0);
 await assert.rejects(db.query('select checkpoint_fba_sales_sync($1,$2,$3)',[A,c.runId,JSON.stringify(state)]),/STALE_CHECKPOINT/);
 await commit(db,c.runId,[row({report_id:'456',sale_date:'2026-09-02',row_fingerprint:'identity2'})]);
 const summary=(await db.query('select * from amazon_sync_jobs')).rows[0];
 assert.equal(summary.last_status,'SUCCESS');assert.equal(summary.last_rows_upserted,2);assert.ok(summary.last_success_at);
 assert.equal((await claim(db)).state.status,'COMPLETED');
 }finally{await db.close()}
});
test('failure in final amazon_sync_jobs write rolls back RAW, canonical and checkpoint',async()=>{
 const db=await database();try{
 await db.exec("alter table amazon_sync_jobs add constraint deny_success check(last_status <> 'SUCCESS')");
 await job(db);const c=await claim(db);await assert.rejects(commit(db,c.runId),/deny_success/);
 assert.equal((await db.query('select count(*)::int n from amazon_fba_sales_daily_raw')).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from ventas_diarias')).rows[0].n,0);
 assert.equal((await claim(db)).state.chunkIndex,0);
 }finally{await db.close()}
});
test('SQL refuses absent or partial report evidence, foreign report rows and forged completion',async()=>{
 const db=await database();try{
 const state=initial();delete state.chunks[0].diagnostic;await job(db,A,state);const c=await claim(db);
 await assert.rejects(commit(db,c.runId),/REPORT_RANGE_OR_DOCUMENT_NOT_VERIFIED/);
 const partial=initial();partial.chunks[0].diagnostic.dataStartTime='2026-09-01T12:00:00Z';
 await db.query('select checkpoint_fba_sales_sync($1,$2,$3)',[A,c.runId,JSON.stringify(partial)]);
 await assert.rejects(commit(db,c.runId),/REPORT_RANGE_OR_DOCUMENT_NOT_VERIFIED/);
 await db.query('select checkpoint_fba_sales_sync($1,$2,$3)',[A,c.runId,JSON.stringify(initial())]);
 for(const changed of [{report_id:'foreign'},{sale_date:'2026-09-02'}]) await assert.rejects(commit(db,c.runId,[row(changed)]),/RAW_OUTSIDE_VALIDATED_REPORT/);
 await assert.rejects(db.query('select checkpoint_fba_sales_sync($1,$2,$3)',[A,c.runId,JSON.stringify({...initial(),status:'COMPLETED'})]),/PUBLICATION_REQUIRED/);
 assert.equal((await db.query('select count(*)::int n from amazon_fba_sales_daily_raw')).rows[0].n,0);
 }finally{await db.close()}
});
test('coordinator migration is repeatable and service_role can use fenced RPCs',async()=>{
 const db=await database();try{
 await db.exec(await read('20260922_01_fba_sales_coordinator.sql'));
 const preflight=await db.exec(await readFile(new URL('../../sql/diagnostics/fba_sales_coordinator_preflight_readonly.sql',import.meta.url),'utf8'));
 assert.equal(preflight[1].rows[0].transaction_read_only,'on');
 await job(db);
 await db.exec('grant usage on schema public to service_role;grant select,update on amazon_spapi_report_jobs to service_role;grant select,insert,update on amazon_report_sync_runs to service_role;set role service_role');
 const c=await claim(db);assert.ok(c.runId);await commit(db,c.runId);
 assert.equal((await claim(db)).state.status,'COMPLETED');
 await assert.rejects(db.query("select sync_ventas_diarias_from_amazon_fba_sales('2026-09-01','2026-09-02')"),/permission denied/);
 }finally{await db.close()}
});
