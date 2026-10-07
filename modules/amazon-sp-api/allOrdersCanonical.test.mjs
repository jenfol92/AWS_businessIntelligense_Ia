import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSalesAmazonIdentity } from './amazonInventoryIdentityResolver.ts';
import { parseAllOrdersRows } from './allOrdersReportParser.ts';
import { buildOrdersState, assertSameScope, splitIntoWindows, summarizeCoverage, rollingRange, localMidnightUtc } from './allOrdersSyncPolicy.ts';
import { tickAllOrders } from './allOrdersSyncCoordinator.ts';
const A='B012345678', B='B087654321';
const evidence=[{productoId:'p1',sellerSku:'123',source:'PRODUCT_SKU'},{productoId:'p1',asin:A,source:'PRODUCT_ASIN'},{productoId:'p1',sellerSku:'historic',asin:A,source:'LEDGER'},{productoId:'p2',sellerSku:'456',source:'PRODUCT_SKU'},{productoId:'p2',asin:B,source:'PRODUCT_ASIN'}];
for(const [name,sku,asin,extra,status,id] of [
 ['ASIN + correct SKU','123',A,[],'SAFE_BY_ASIN','p1'],
 ['generic unknown alias + known ASIN','new-arbitrary',A,[],'SAFE_BY_ASIN','p1'],
 ['ASIN + contradictory SKU','456',A,[],'IDENTITY_CONFLICT',null],
 ['duplicate ASIN checked BEFORE alias return','historic',A,[{productoId:'p2',asin:A,source:'LEDGER'}],'IDENTITY_CONFLICT',null],
 ['empty ASIN + exact SKU','123','',[],'SAFE_BY_SKU_EXACT','p1'],
 ['empty ASIN + persisted alias','historic','',[],'SAFE_BY_ALIAS','p1'],
 ['unknown ASIN + exact SKU','123','B099999999',[],'SAFE_BY_SKU_EXACT','p1'],
 ['shared EAN heuristic','f8436616610000','',[{productoId:'p1',ean:'8436616610000',source:'MASTER_EAN'},{productoId:'p2',ean:'8436616610000',source:'MASTER_EAN'}],'IDENTITY_AMBIGUOUS',null],
 ['unique heuristic never auto assigns','f8436616610000','',[{productoId:'p1',ean:'8436616610000',source:'MASTER_EAN'}],'UNRESOLVED',null],
 ['unknown','missing','',[],'UNRESOLVED',null],
 ['ambiguous persisted alias','historic','',[{productoId:'p2',sellerSku:'historic',source:'LEDGER'}],'IDENTITY_AMBIGUOUS',null],
])test('identity: '+name,()=>{const r=resolveSalesAmazonIdentity(sku,asin,[...evidence,...extra]);assert.equal(r.status,status);assert.equal(r.productoId,id)});
const base={'amazon-order-id':'o1',sku:'123',asin:A,'purchase-date':'2026-07-01T22:30:00Z',quantity:'1','fulfillment-channel':'Amazon','sales-channel':'Amazon.es','order-status':'Pending','item-status':'Pending'};
for(const [channel,expected] of [['Amazon','FBA'],['Merchant','FBM']])test('channel '+expected,()=>{const rows=parseAllOrdersRows([{...base,'fulfillment-channel':channel}],{matchProduct:()=> 'p1'}).rows;assert.equal(rows[0].fulfillment_channel,expected);assert.equal(rows[0].fulfillment_channel_original,channel)});
for(const status of ['Pending','Shipped','Cancelled'])test('preserve status '+status,()=>{assert.equal(parseAllOrdersRows([{...base,'order-status':status,'item-status':status}]).rows[0].order_status,status)});
for(const [country,sales,date,expected] of [
 ['ES','Amazon.es','2026-07-01T22:30:00Z','2026-07-02'],
 ['GB','Amazon.co.uk','2026-07-01T23:30:00Z','2026-07-02'],
 ['IE','Amazon.ie','2026-07-01T23:30:00Z','2026-07-02'],
 ['AE','Amazon.ae','2026-07-01T21:30:00Z','2026-07-02'],
 ['SA','Amazon.sa','2026-07-01T21:30:00Z','2026-07-02'],
 ['GB','Amazon.co.uk','2026-01-01T23:30:00Z','2026-01-01'],
])test('timezone '+country+' '+date,()=>assert.equal(parseAllOrdersRows([{...base,'sales-channel':sales,'purchase-date':date}]).rows[0].purchase_date,expected));
test('Non-Amazon preserved with explicit UTC and classification',()=>{const r=parseAllOrdersRows([{...base,'sales-channel':'Non-Amazon'}]).rows[0];assert.equal(r.marketplace_country,'UNKNOWN');assert.equal(r.marketplace_classification,'NON_AMAZON');assert.equal(r.purchase_timezone,'UTC');assert.equal(r.sales_channel,'Non-Amazon')});
test('unknown marketplace preserved explicitly, invalid fulfillment fails',()=>{assert.equal(parseAllOrdersRows([{...base,'sales-channel':'Amazon.future'}]).rows[0].marketplace_classification,'UNKNOWN');assert.throws(()=>parseAllOrdersRows([{...base,'fulfillment-channel':'Unexpected'}]),/UNKNOWN_FULFILLMENT/)});
test('quantity zero retained; invalid quantity rejected',()=>{assert.equal(parseAllOrdersRows([{...base,quantity:'0'}]).rows[0].quantity,0);for(const q of ['-1','x','1.5',''])assert.throws(()=>parseAllOrdersRows([{...base,quantity:q}]),/QUANTITY/)});
test('idempotent report aggregates repeated same order SKU ASIN; different SKU independent',()=>{const input=[base,{...base,quantity:'2'},{...base,sku:'456'}];const a=parseAllOrdersRows(input).rows,b=parseAllOrdersRows(input).rows;assert.deepEqual(a,b);assert.equal(a.length,2);assert.equal(a[0].quantity,3)});
test('same product in both channels, distinct orders',()=>{const rows=parseAllOrdersRows([base,{...base,'amazon-order-id':'o2','fulfillment-channel':'Merchant'}],{matchProduct:()=> 'p1'}).rows;assert.deepEqual(rows.map(r=>r.fulfillment_channel),['FBA','FBM']);assert.ok(rows.every(r=>r.producto_id==='p1'))});
test('ambiguous fingerprint with differing channel/status blocked',()=>{assert.throws(()=>parseAllOrdersRows([base,{...base,'fulfillment-channel':'Merchant'}]),/DUPLICATE_IDENTITY_CONFLICT/);assert.throws(()=>parseAllOrdersRows([base,{...base,'item-status':'Cancelled'}]),/DUPLICATE_IDENTITY_CONFLICT/)});
const initial=()=>buildOrdersState('2026-07-01','2026-07-02',['A1RKKUPIHCS9HS'],new Date('2026-08-01'));
test('ranges identical resume; different scope/range conflict',()=>{const s=initial();assert.doesNotThrow(()=>assertSameScope(s,structuredClone(s)));assert.throws(()=>assertSameScope(s,{...s,toDate:'2026-07-03'}),/RANGE_CONFLICT/);assert.throws(()=>assertSameScope(s,{...s,marketplaceIds:['other']}),/RANGE_CONFLICT/)});
test('multi chunk, gap-free, UTC windows <=30 days including DST',()=>{const s=buildOrdersState('2026-03-01','2026-05-01',['A1RKKUPIHCS9HS'],new Date('2026-06-01'));assert.equal(s.windows.length,3);for(const w of s.windows)assert.ok(Date.parse(w.dataEndTime)-Date.parse(w.dataStartTime)<=30*86400000);assert.equal(s.windows[1].fromDate,'2026-03-30');assert.throws(()=>splitIntoWindows('2026-02-30','2026-03-01'));assert.throws(()=>splitIntoWindows('2026-01-01','2026-01-02',0))});
test('14 day rolling configurable; current date explicitly PARTIAL',()=>{assert.deepEqual(rollingRange(new Date('2026-10-07T12:00Z')),{fromDate:'2026-09-24',toDate:'2026-10-07'});assert.equal(rollingRange(new Date('2026-10-07T12:00Z'),'7').fromDate,'2026-10-01');assert.throws(()=>rollingRange(new Date(),'0'));const s=buildOrdersState('2026-10-06','2026-10-07',['A1RKKUPIHCS9HS'],new Date('2026-10-07T12:00Z'));assert.deepEqual(s.windows.map(w=>w.coverageStatus),['COMPLETE','PARTIAL']);assert.equal(s.windows[1].dataEndTime,'2026-10-07T11:57:00.000Z');assert.throws(()=>buildOrdersState('2026-10-08','2026-10-08',['A1RKKUPIHCS9HS'],new Date('2026-10-07T12:00Z')),/IN_FUTURE/)});
for(const [country,expected] of [['ES','2026-06-30T22:00:00.000Z'],['GB','2026-06-30T23:00:00.000Z'],['IE','2026-06-30T23:00:00.000Z'],['AE','2026-06-30T20:00:00.000Z'],['SA','2026-06-30T21:00:00.000Z']])test('UTC boundary '+country,()=>assert.equal(localMidnightUtc('2026-07-01',country),expected));
for(const [status,intervals] of [
 ['MISSING',[]],['COMPLETE',[{start_date:'2026-07-01',end_date:'2026-07-03',status:'COMPLETE'}]],
 ['PARTIAL',[{start_date:'2026-07-01',end_date:'2026-07-01',status:'COMPLETE'},{start_date:'2026-07-03',end_date:'2026-07-03',status:'COMPLETE'}]],
 ['FAILED',[{start_date:'2026-07-01',end_date:'2026-07-03',status:'FAILED'}]],
 ['IN_PROGRESS',[{start_date:'2026-07-01',end_date:'2026-07-03',status:'IN_PROGRESS'}]],
 ['PARTIAL',[{start_date:'2026-07-01',end_date:'2026-07-03',status:'PARTIAL'}]],
])test('coverage '+status,()=>{const c=summarizeCoverage('2026-07-01','2026-07-03',intervals);assert.equal(c.status,status);if(status==='PARTIAL'&&intervals.length===2)assert.equal(c.days[1].status,'MISSING')});
function deps(overrides={}){return {now:()=>new Date('2026-08-01'),save:async()=>{},create:async()=> 'report1',poll:async()=>({status:'DONE',documentId:'doc1',observedAt:'2026-08-01T00:00Z'}),import:async()=>[],...overrides}}
test('CREATE/POLL/IMPORT/COMPLETE zero rows are valid, recovery waits',async()=>{const s=initial();let calls=0;const d=deps({create:async()=>{calls++;return 'report1'}});await tickAllOrders(s,d);assert.equal(s.windows[0].phase,'POLL');await tickAllOrders(s,d);assert.equal(calls,1);s.nextAttemptAt=null;await tickAllOrders(s,d);assert.equal(s.windows[0].phase,'IMPORT');await tickAllOrders(s,d);assert.equal(s.windows[0].phase,'COMPLETE');assert.equal(s.windows[0].rowsUpserted,0);await tickAllOrders(s,d);assert.equal(calls,1)});
for(const status of ['CANCELLED','FATAL'])test('report '+status+' never invents coverage',async()=>{const s=initial();s.windows[0].phase='POLL';s.windows[0].reportId='report1';await tickAllOrders(s,deps({poll:async()=>({status})}));assert.equal(s.windows[0].phase,'FAILED')});
test('lost CREATE result never repeats create',async()=>{const s=initial();s.windows[0].createIntentAt='2026-07-31';let called=false;await tickAllOrders(s,deps({create:async()=>{called=true}}));assert.equal(called,false);assert.equal(s.error,'ALL_ORDERS_CREATE_OUTCOME_UNCERTAIN')});
test('transient POLL failure backs off, keeps evidence and is recoverable',async()=>{const s=initial();s.windows[0].phase='POLL';s.windows[0].reportId='r1';await tickAllOrders(s,deps({poll:async()=>{throw Object.assign(new Error('temporary'),{code:'server_error'})}}));assert.equal(s.error,null);assert.equal(s.windows[0].phase,'POLL');assert.equal(s.windows[0].reportId,'r1');assert.equal(s.nextAttemptAt,'2026-08-01T00:01:00.000Z')});
test('rate limit Retry-After and IN_PROGRESS respected',async()=>{const s=initial();await tickAllOrders(s,deps({create:async()=>{throw Object.assign(new Error('limited'),{code:'rate_limited',details:{headers:{'retry-after':'120'}}})}}));assert.equal(s.error,null);assert.equal(s.nextAttemptAt,'2026-08-01T00:02:00.000Z');assert.equal(s.windows[0].createIntentAt,undefined);s.windows[0].phase='POLL';s.nextAttemptAt=null;await tickAllOrders(s,deps({poll:async()=>({status:'IN_PROGRESS'})}));assert.equal(s.nextAttemptAt,'2026-08-01T00:01:00.000Z')});
