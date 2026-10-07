import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAmazonFbaLedgerSummaryText} from './parser.ts';
import {LEDGER_QUANTITY_COLUMNS,strictLedgerInteger,LEDGER_MAX_BYTES} from './strictLedgerDocument.ts';
import {readLedgerPages} from './ledgerPagination.ts';
import {dedupeLedgerRowsForUpsert} from './ledgerCanonicalIdentity.ts';
import {aggregateLatestLedgerByCountry} from '../../inventory/services/ledgerCountryStock.ts';
const headers=['Date','MSKU','ASIN','FNSKU','Disposition','Location',...LEDGER_QUANTITY_COLUMNS];
const row=['08/13/2026','f8436616610364','B0GLQKQJWY','B0GLQKQJWY','SELLABLE','DE',...LEDGER_QUANTITY_COLUMNS.map(()=> '0')];
const document=(r=row,h=headers,sep='\t')=>h.join(sep)+'\n'+r.join(sep);
test('real zero; blank, INVALID, missing quantity, date, truncation and PapaParse errors fail closed',async()=>{
 assert.equal((await parseAmazonFbaLedgerSummaryText(document())).validRows[0].endingWarehouseBalance,0);
 for(const value of ['', 'INVALID','1.5','1e3','2147483648'])assert.throws(()=>strictLedgerInteger(value));
 for(const r of [row.with(6,''),row.with(6,'INVALID'),row.with(0,'02/30/2026'),row.slice(0,-1),row.with(1,'"unterminated')])await assert.rejects(parseAmazonFbaLedgerSummaryText(document(r)));
 await assert.rejects(parseAmazonFbaLedgerSummaryText(document(row.slice(0,-1),headers.slice(0,-1))),/MISSING_COLUMN/);
 await assert.rejects(parseAmazonFbaLedgerSummaryText(document([...row,'unexpected'])),/CSV_STRUCTURE/);
 await assert.rejects(parseAmazonFbaLedgerSummaryText(document(row,headers,',')+'\n"unterminated'),/CSV_STRUCTURE/);
 await assert.rejects(parseAmazonFbaLedgerSummaryText('x'.repeat(LEDGER_MAX_BYTES+1)),/TOO_LARGE/);
});
test('pagination reads 1507 and exact 1000 rows without a PostgREST truncation',async()=>{
 for(const n of [1000,1507]){
  const source=Array.from({length:n},(_,id)=>({id}));let calls=0;
  const rows=await readLedgerPages(async(from,to)=>{calls++;assert.ok(to-from<1000);return {data:source.slice(from,to+1),error:null};});
  assert.equal(rows.length,n);assert.equal(calls,Math.floor(n/500)+1);
 }
 await assert.rejects(readLedgerPages(async()=>({data:null,error:{message:'timeout'}})));
});
test('Bubbly same FNSKU at DE and GB keeps locations, aliases and documentary quantities; UNKNOWN never becomes NEW',()=>{
 const base={producto_id:'6e4cf3cf-7906-414f-8644-4ba91dd8c09f',sku_original:'f8436616610364',sku_limpio:'8436616610364',msku_aliases:['f8436616610364'],asin:'B0GLQKQJWY',fnsku:'B0GLQKQJWY',snapshot_date:'2026-08-13',disposition:'SELLABLE',condition_type:'UNKNOWN',document_identity:'report:test',location:'DE',location_raw:'DE',physical_country:'DE',ending_warehouse_balance:196,in_transit_between_warehouses:18,raw:{}};
 const rows=dedupeLedgerRowsForUpsert([base,{...base},{...base,location:'GB',location_raw:'GB',physical_country:'GB',ending_warehouse_balance:7,in_transit_between_warehouses:0}]);
 assert.equal(rows.length,2);assert.equal(rows[0].msku_aliases.length,1);
 const result=aggregateLatestLedgerByCountry(rows,'2026-09-29').get(base.producto_id);
 assert.equal(result.find(r=>r.pais==='DE').stockTotal,196);assert.equal(result.find(r=>r.pais==='DE').stockInTransit,18);
 assert.equal(result.find(r=>r.pais==='DE').stockSellable,0);assert.equal(result.find(r=>r.pais==='DE').stockUnknownConditionSellable,196);
 assert.equal(result.find(r=>r.pais==='DE').isStale,true);
 for(const condition_type of ['NEW','NEWITEM'])assert.equal(aggregateLatestLedgerByCountry([{...base,condition_type}], '2026-09-29').get(base.producto_id)[0].stockSellable,196);
 assert.equal(aggregateLatestLedgerByCountry([{...base,location:'unclassified',physical_country:null}], '2026-09-29').get(base.producto_id)[0].pais,'UNKNOWN_LOCATION');
});
