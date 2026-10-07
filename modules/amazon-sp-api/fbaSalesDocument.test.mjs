import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {isUtcDateOnly} from './fbaSalesSyncPolicy.ts';
import * as marketplace from './marketplaceMapping.ts';
const require=createRequire(import.meta.url),ts=require('typescript');
function compile(file,resolve) {
 const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');
 const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const module={exports:{}};new Function('require','module','exports',js)(resolve,module,module.exports);return module.exports;
}
const utils=compile('./spApiReportImportUtils.ts',name=>name==='node:crypto'||name==='papaparse'?require(name):{});
const service=compile('./fbaForecastSpApiImportsService.ts',name=>{
 if(name==='papaparse')return require(name);
 if(name==='./spApiReportImportUtils')return utils;
 if(name==='./fbaSalesSyncPolicy')return {isUtcDateOnly};
 if(name==='./marketplaceMapping')return marketplace;
 if(name==='@/server/supabase/adminClient')return {supabaseAdmin:{from:table=>{
   assert.equal(table,'paises');return {select:async()=>({data:[{code:'ES'}],error:null})};
 }}};
 if(name==='./skuProductMatching')return {resolveProductMatchesBySku:async skus=>new Map(skus.map(sku=>[sku,{productoId:'product',skuLimpio:sku}]))};
 return {};
});
const header='amazon-order-id\tshipment-id\tshipment-item-id\tsku\tquantity-shipped\tshipment-date\tsales-channel';
const doc=(quantity=3,date='2026-09-01')=>header+`\norder\tshipment\titem\tsku\t${quantity}\t${date}\tamazon.es`;
function fixture() {
 const raw=new Map();let commits=0;
 const params={reportId:'123',reportType:'GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL',marketplaceIds:['A1RKKUPIHCS9HS'],fromDate:'2026-09-01',toDate:'2026-09-02',status:'DONE',processingStatus:'DONE',commit:async rows=>{
  commits++;for(const row of rows)raw.set(row.row_fingerprint,row);return {inserted:raw.size,units:[...raw.values()].reduce((n,r)=>n+r.quantity,0)};
 }};
 return {raw,params,commits:()=>commits,run:documentText=>service.parseAndPersistFbaSalesReportDocument({...params,documentText})};
}
test('document validated; repeat identity updates quantity without duplicates',async()=>{
 const f=fixture();const result=await f.run(doc());assert.equal(result.status,'COMPLETED');await f.run(doc());assert.equal(f.raw.size,1);
 await f.run(doc(5));assert.equal([...f.raw.values()][0].quantity,5);
});
test('preserves supported localized header aliases',async()=>{
 const f=fixture();const localized=doc().replace('amazon-order-id','numero de pedido de amazon').replace('quantity-shipped','cantidad enviada').replace('shipment-date','fecha de envio').replace('sales-channel','canal de venta');
 assert.equal((await f.run(localized)).status,'COMPLETED');
});
test('documented unresolved semantics: 3 to 0 and missing row retain old quantity',async()=>{
 const f=fixture();await f.run(doc());await f.run(doc(0));assert.equal([...f.raw.values()][0].quantity,3);
 await f.run(header);assert.equal([...f.raw.values()][0].quantity,3);
});
test('documented unresolved semantics: sale_date changes fingerprint',async()=>{
 const f=fixture();await f.run(doc());await f.run(doc(3,'2026-09-02'));assert.equal(f.raw.size,2);
});
for(const text of ['<html>error</html>',doc('NaN'),doc(3,'2026-02-30'),doc(3,'2026-08-31')]) test('invalid document never commits '+text.slice(-20),async()=>{
 const f=fixture();await assert.rejects(f.run(text));assert.equal(f.commits(),0);
});
test('canonical failure never returns COMPLETED',async()=>{
 const f=fixture();f.params.commit=async()=>{throw new Error('canonical failure')};await assert.rejects(f.run(doc()),/canonical failure/);
});
