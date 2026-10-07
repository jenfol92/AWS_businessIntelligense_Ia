import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import * as policy from './fbaSalesSyncPolicy.ts';
import {buildCanonicalSalesMarketplaceScope} from './marketplaceMapping.ts';
const require=createRequire(import.meta.url),ts=require('typescript');
function route(path,status='PENDING',authorized=true) {
 let calls=0,lastInput;
 const coordinate=async input=>{calls++;lastInput=input;if(status==='THROW')throw new Error('coordinator unavailable');return {ok:status==='COMPLETED',status,jobId:'job',summary:{status}}};
 const source=fs.readFileSync(new URL('../../'+path,import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const compiledModule={exports:{}};
 const deps=name=>{
  if(name==='next/server')return {NextResponse:{json:(body,options)=>({body,status:options?.status??200})}};
  if(name.endsWith('/fbaSalesSyncPolicy'))return policy;
  if(name.endsWith('/fbaSalesSyncCoordinator'))return {coordinateFbaSalesSync:coordinate,resumeFbaSalesSync:coordinate,resumeDueFbaSalesSync:coordinate};
  if(name.endsWith('/amazonReportSchedulerService'))return {runSafeAmazonReportScheduler:async()=>({errors:[]})};
  if(name.endsWith('/fbmSyncRecovery'))return {recoverPendingFbmSync:async()=>null};
  if(name.endsWith('/fbaLedgerSyncRecovery'))return {recoverPendingLedgerSync:async()=>null};
  if(name.endsWith('/marketplaceMapping'))return {buildCanonicalSalesMarketplaceScope};
  if(name.endsWith('/adminClient'))return {supabaseAdmin:{from:table=>{
   assert.equal(table,'v_amazon_fba_sales_daily');const query={select:()=>query,gte:()=>query,lt:()=>query,neq:async()=>({data:[{marketplace_id:'A1RKKUPIHCS9HS'}],error:null})};return query;
  }}};
  if(name.endsWith('/fbaForecastSpApiImportsService'))return {importFbaSalesDailyFromSpApi:coordinate,importFbaSalesFromExistingReport:coordinate,isSupportedFbaSalesReportType:v=>v==='GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL'};
  if(name.endsWith('/routeClient'))return {createSupabaseRouteClient:()=>({auth:{getUser:async()=>({data:{user:authorized?{id:'user'}:null}})}})};
  if(name.endsWith('/config'))return {getMissingSpApiEnvKeys:()=>[]};
  if(name.endsWith('/errors'))return {mapGenericError:e=>({message:e.message,status:400})};
  throw new Error('Unexpected dependency '+name);
 };
 new Function('require','module','exports',js)(deps,compiledModule,compiledModule.exports);
 return {handler:compiledModule.exports.POST,get:compiledModule.exports.GET,calls:()=>calls,input:()=>lastInput};
}
const manual='app/api/amazon/reports/fba-sales/import/route.ts',cron='app/api/cron/amazon-sp-api/reports/fba-sales/import/route.ts';
const body={fromDate:'2026-06-24',toDate:'2026-09-21'};
function request(value=body,secret='local-test') {return {json:async()=>value,text:async()=>JSON.stringify(value),headers:new Headers({authorization:`Bearer ${secret}`})};}
for(const path of [manual,cron]) for(const state of ['PENDING','PROCESSING','RATE_LIMITED','COMPLETED','FATAL','FAILED']) test(`${path} ${state}`,async()=>{
 process.env.CRON_SECRET='local-test';const f=route(path,state);const res=await f.handler(request());
 assert.equal(res.status,policy.salesSyncHttpStatus(state));assert.equal(res.body.ok,state==='COMPLETED');assert.equal(f.calls(),1);
});
test('manual auth and cron secret remain mandatory before work',async()=>{
 const m=route(manual,'PENDING',false);assert.equal((await m.handler(request())).status,401);assert.equal(m.calls(),0);
 process.env.CRON_SECRET='local-test';const c=route(cron);assert.equal((await c.handler(request(body,'wrong'))).status,401);assert.equal(c.calls(),0);
 delete process.env.CRON_SECRET;assert.equal((await c.handler(request())).status,401);assert.equal(c.calls(),0);
});
test('manual and cron reject impossible dates and resume jobId',async()=>{
 process.env.CRON_SECRET='local-test';for(const path of [manual,cron]) {const f=route(path);
 assert.equal((await f.handler(request({...body,fromDate:'2026-02-30'}))).status,400);assert.equal(f.calls(),0);
 assert.equal((await f.handler(request({jobId:'job'}))).status,202);assert.equal(f.calls(),1);}
});
for(const state of ['PENDING','PROCESSING','RATE_LIMITED','COMPLETED','FATAL','FAILED']) test('syncOnly route uses coordinator '+state,async()=>{
 process.env.CRON_SECRET='local-test';const f=route('app/api/cron/amazon-sp-api/reports/fba-sales-to-ventas-diarias/route.ts',state);
 const res=await f.handler(request({startDate:'2026-09-01',endDate:'2026-09-03',marketplaceIds:['A1RKKUPIHCS9HS']}));
 assert.equal(res.status,policy.salesSyncHttpStatus(state));assert.equal(res.body.ok,state==='COMPLETED');
 assert.deepEqual(f.input(),{fromDate:'2026-09-01',toDate:'2026-09-02',marketplaceIds:['A1RKKUPIHCS9HS'],mode:'syncOnly',tipoCliente:'B2C'});
});
for(const state of ['PENDING','RATE_LIMITED','COMPLETED','FATAL','FAILED','THROW']) test('hourly route exposes sales failure '+state,async()=>{
 process.env.CRON_SECRET='local-test';process.env.AMAZON_REPORT_SCHEDULER_ENABLED='true';
 const f=route('app/api/cron/amazon/reports/run/route.ts',state);const res=await f.get(request());
 const failed=['FATAL','FAILED','THROW'].includes(state);assert.equal(res.status,failed?502:200);assert.equal(res.body.ok,!failed);
 assert.equal(res.body.fbaSales.ok,state==='COMPLETED');assert.equal(f.calls(),1);
});
