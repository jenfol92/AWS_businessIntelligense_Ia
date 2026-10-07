// Executes only an isolated in-memory PostgreSQL. No application clients/env are loaded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {initialLedgerState,LEDGER_REPORT_TYPE,LEDGER_OWNER} from './fbaLedgerSyncPolicy.ts';
import { PGlite } from '@electric-sql/pglite';
const P='6e4cf3cf-7906-414f-8644-4ba91dd8c09f';
const quantities=['starting_warehouse_balance','ending_warehouse_balance','in_transit_between_warehouses','receipts','customer_shipments','customer_returns','vendor_returns','warehouse_transfer_in_out','found','lost','damaged','disposed','other_events','unknown_events'];
function row(doc,overrides={}) {return {...Object.fromEntries(quantities.map(q=>[q,0])),producto_id:P,sku_original:'f8436616610364',sku_limpio:'8436616610364',msku_aliases:['f8436616610364'],asin:'B0GLQKQJWY',fnsku:'B0GLQKQJWY',snapshot_date:'2026-08-13',disposition:'SELLABLE',condition_type:'UNKNOWN',document_identity:`report:${doc}`,document_identity_type:'REPORT_DOCUMENT_ID',report_document_id:doc,location:'DE',location_raw:'DE',location_type:'COUNTRY',physical_country:'DE',ending_warehouse_balance:196,in_transit_between_warehouses:18,duplicate_provenance:[],source:LEDGER_OWNER,updated_at:'2026-08-14T00:00:00Z',...overrides};}
async function seed(db,rows,options={}) {
 const id=randomUUID(),s=initialLedgerState('2026-08-13',['ATEST']);
 const doc=rows[0].report_document_id,payload=JSON.stringify(rows),digest=createHash('sha256').update(payload).digest('hex');
 const unlinkedRows=rows.filter(r=>!r.producto_id).length,unclassifiedLocations=rows.filter(r=>!r.physical_country).length;
 const manifest={version:1,reportType:LEDGER_REPORT_TYPE,fromDate:s.date,toDate:s.date,marketplaceIds:s.marketplaceIds,aggregateByLocation:'COUNTRY',aggregatedByTimePeriod:'DAILY',reportId:'report-'+doc,documentId:doc,digest,documentDigest:'a'.repeat(64),parsedRows:rows.length,canonicalRows:rows.length,linkedRows:rows.length-unlinkedRows,unlinkedRows,unclassifiedLocations,unknownConditionRows:rows.filter(r=>r.condition_type==='UNKNOWN').length,duplicateRows:0,warnings:[],errors:[],coverageValid:!unlinkedRows&&!unclassifiedLocations,publishedAt:null};
 Object.assign(s,{revision:2,phase:'PUBLISH',status:'PROCESSING',reportId:manifest.reportId,documentId:doc,reportCreatedAt:options.createdAt??'2026-08-14T01:00:00Z',manifest,lease:{token:randomUUID(),expiresAt:new Date(Date.now()+120000).toISOString()}});
 await db.query('insert into amazon_spapi_report_jobs(id,source,report_type,report_id,report_document_id,marketplace_ids,status,raw) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,LEDGER_OWNER,LEDGER_REPORT_TYPE,s.reportId,doc,s.marketplaceIds,s.status,JSON.stringify({ledger:s})]);
 return {id,s,payload,manifest};
}
const commit=(db,j,revision=j.s.revision,token=j.s.lease.token)=>db.query('select commit_fba_ledger_publication($1,$2,$3,$4,$5) receipt',[j.id,revision,token,j.payload,JSON.stringify(j.manifest)]);
test('actual PostgreSQL RPC: atomic publication, replay, fencing, canonical selection and RLS',async t=>{
 const db=new PGlite();
 try {
  await db.exec(await readFile(new URL('./fbaLedgerTestSchema.sql',import.meta.url),'utf8'));
  await db.query('insert into productos values($1)',[P]);
  const migration=await readFile(new URL('../../sql/migrations/20260929_01_fba_ledger_durable.sql',import.meta.url),'utf8');
  await t.test('existing UUID column without FK is repaired and migration can run twice',async()=>{
   await db.exec('alter table amazon_fba_inventory_ledger_daily add column publication_job_id uuid');
   await db.exec(migration);await db.exec(migration);
   assert.equal((await db.query("select count(*) n from pg_constraint where conrelid='amazon_fba_inventory_ledger_daily'::regclass and contype='f' and confrelid='amazon_spapi_report_jobs'::regclass")).rows[0].n,1);
   assert.equal((await db.query("select count(*) n from pg_trigger where tgrelid='amazon_fba_inventory_ledger_daily'::regclass and tgname='guard_published_fba_ledger'")).rows[0].n,1);
  });
  const views=['v_product_fba_stock_daily','v_latest_fba_inventory_by_product_country','v_latest_fba_inventory_by_product_location'];
  await t.test('legacy data alone gives no certified rows, never a synthetic stock zero',async()=>{
   const legacy=row('legacy');const keys=Object.keys(legacy);
   await db.query(`insert into amazon_fba_inventory_ledger_daily (${keys.join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')})`,keys.map(k=>k==='duplicate_provenance'?'[]':legacy[k]));
   for(const view of views) assert.equal((await db.query(`select * from ${view}`)).rows.length,0);
   assert.equal((await db.query('select * from read_published_fba_ledger($1)',[[P]])).rows.length,0);
   await db.exec("delete from amazon_fba_inventory_ledger_daily where report_document_id='legacy'");
  });
  await t.test('late FK failure rolls back every inserted row and job receipt',async()=>{
   const j=await seed(db,[row('bad'),row('bad',{location_raw:'GB',producto_id:randomUUID()})]);
   await assert.rejects(commit(db,j),/foreign key/);
   assert.equal((await db.query('select count(*) n from amazon_fba_inventory_ledger_daily')).rows[0].n,0);
   assert.equal((await db.query("select raw->'ledger'->>'status' status from amazon_spapi_report_jobs where id=$1",[j.id])).rows[0].status,'PROCESSING');
  });
  await t.test('revision, token, expiry, digest and missing quantity are rejected',async()=>{
   const j=await seed(db,[row('fences')]);await assert.rejects(commit(db,j,1),/FENCE/);await assert.rejects(commit(db,j,2,'other'),/FENCE/);
   await db.query("update amazon_spapi_report_jobs set raw=jsonb_set(raw,'{ledger,lease,expiresAt}',to_jsonb('2000-01-01T00:00:00Z'::text)) where id=$1",[j.id]);
   await assert.rejects(commit(db,j),/FENCE/);
   const m=await seed(db,[row('digest')]);m.payload+=' ';await assert.rejects(commit(db,m),/DIGEST/);
   const incomplete=row('missing');delete incomplete.receipts;const k=await seed(db,[incomplete]);await assert.rejects(commit(db,k),/QUANTITY/);
  });
  let published;
  await t.test('unlinked rows and unknown locations remain published and counted; >1000 rows',async()=>{
   const rows=Array.from({length:1007},(_,i)=>row('complete',{fnsku:'FN'+i,producto_id:i===0?null:P,physical_country:i===0?null:'DE',location_type:i===0?'UNKNOWN':'COUNTRY'}));
   published=await seed(db,rows);const receipt=(await commit(db,published)).rows[0].receipt;assert.equal(receipt.rows,1007);
   assert.equal((await db.query("select count(*) n from amazon_fba_inventory_ledger_daily where producto_id is null")).rows[0].n,1);
   assert.equal((await db.query('select count(*) n from read_published_fba_ledger($1)',[[P]])).rows[0].n,1006);
   assert.equal((await db.query('select bool_or(coverage_valid) b from read_published_fba_ledger($1)',[[P]])).rows[0].b,false);
   assert.equal((await db.query('select count(*) n from v_published_fba_ledger_daily')).rows[0].n,1007);
   for(const view of views) assert.equal((await db.query(`select * from ${view}`)).rows.length,0);
  });
  await t.test('lost response/replay returns same receipt without inserting again; immutable rows',async()=>{
   const a=(await commit(db,published)).rows[0].receipt,b=(await commit(db,published)).rows[0].receipt;assert.deepEqual(a,b);
   assert.equal((await db.query('select count(*) n from amazon_fba_inventory_ledger_daily')).rows[0].n,1007);
   await assert.rejects(db.exec('update amazon_fba_inventory_ledger_daily set ending_warehouse_balance=999'),/IMMUTABLE/);
  });
  await t.test('different report same day supersedes whole document; no double sum or older product fallback',async()=>{
   const j=await seed(db,[row('newer')],{createdAt:'2026-08-14T02:00:00Z'});await commit(db,j);
   const totals=(await db.query('select count(*) n,sum(ending_warehouse_balance) q from read_published_fba_ledger($1)',[[P]])).rows[0];
   assert.equal(totals.n,1);assert.equal(totals.q,196);
   const duplicate=await seed(db,[row('newer')]);await assert.rejects(commit(db,duplicate),/unique/);
   for(const view of views) assert.equal((await db.query(`select * from ${view}`)).rows.length,1);
  });
  await t.test('authenticated safe read only; anon no evidence, no public publication',async()=>{
   await db.exec('set role authenticated');assert.equal((await db.query('select count(*) n from read_published_fba_ledger($1)',[[P]])).rows[0].n,1);
   assert.equal((await db.query('select count(*) n from v_product_fba_stock_daily')).rows[0].n,1);
   for(const object of ['v_latest_fba_inventory_by_product_country','v_latest_fba_inventory_by_product_location','v_complete_fba_ledger_daily'])
     await assert.rejects(db.query(`select * from ${object}`),/permission/);
   await assert.rejects(db.query('select * from get_latest_fba_ledger_stock_by_products($1)',[[P]]),/permission/);
   await assert.rejects(db.exec('select * from amazon_fba_inventory_ledger_daily'),/permission/);
   await assert.rejects(commit(db,published),/permission/);await db.exec('reset role; set role anon');
   await assert.rejects(db.query('select * from read_published_fba_ledger($1)',[[P]]),/permission/);
   await assert.rejects(db.exec('select * from v_product_fba_stock_daily'),/permission/);await db.exec('reset role');
  });
  await t.test('newer incomplete document hides earlier complete evidence, unknown location retained for observation',async()=>{
   const j=await seed(db,[row('unknown-location',{physical_country:null,location_type:'UNKNOWN',location_raw:'UNCLASSIFIED'})],{createdAt:'2026-08-14T03:00:00Z'});
   await commit(db,j);
   for(const view of views) assert.equal((await db.query(`select * from ${view}`)).rows.length,0);
   const observed=(await db.query('select * from read_published_fba_ledger($1)',[[P]])).rows;
   assert.equal(observed.length,1);assert.equal(observed[0].coverage_valid,false);assert.equal(observed[0].physical_country,null);
   await db.exec(migration);
   assert.equal((await db.query('select * from read_published_fba_ledger($1)',[[P]])).rows.length,1);
  });
 }finally{await db.close();}
});
