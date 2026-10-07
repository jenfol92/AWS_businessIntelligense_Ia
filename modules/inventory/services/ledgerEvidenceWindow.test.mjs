import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildCountryRowsForProduct} from './buildInventoryProduct.ts';
import {aggregateLatestLedgerByCountry} from './ledgerCountryStock.ts';
const P='6e4cf3cf-7906-414f-8644-4ba91dd8c09f';
const context=()=>({inventoryRows:[],fbaInventoryCountryLatest:new Map(),fbmInventorySnapshotLatest:new Map(),
 sales:{byProductCountry:new Map()},marketplaceSales:{byProductMarketplace:new Map()},periodDays:30,canal:'ALL'});
test('before first PUBLISH: no physical row without FBM; FBM ES keeps unknown FBA as null',()=>{
 const ctx=context();assert.deepEqual(buildCountryRowsForProduct(P,ctx),[]);
 ctx.fbmInventorySnapshotLatest.set(P,{availableQuantity:4});
 const [row]=buildCountryRowsForProduct(P,ctx);
 assert.equal(row.stockFbm,4);
 for(const field of ['stockFba','stockFbaUnsellable','stockFbaPhysicalTotal','stockTotal','coverageDays','stockFbaLedgerSnapshotDate'])assert.equal(row[field],null,field);
 assert.equal(row.stockFbaLedgerCoverageValid,false);
});
test('partial geographic evidence preserves positive observations but cannot calculate full coverage or infer missing ES as zero',()=>{
 const ctx=context();ctx.fbmInventorySnapshotLatest.set(P,{availableQuantity:4});
 ctx.fbaInventoryCountryLatest=aggregateLatestLedgerByCountry([{producto_id:P,fnsku:'B0GLQKQJWY',asin:'B0GLQKQJWY',physical_country:'DE',location:'DE',snapshot_date:'2026-08-13',condition_type:'NEW',disposition:'SELLABLE',ending_warehouse_balance:196,coverage_valid:false}],'2026-09-30');
 const rows=buildCountryRowsForProduct(P,ctx),de=rows.find(r=>r.pais==='DE'),es=rows.find(r=>r.pais==='ES');
 assert.equal(de.stockFbaPhysicalTotal,196);assert.equal(de.stockFbaLedgerCoverageValid,false);assert.equal(de.coverageDays,null);assert.equal(es.stockFbaPhysicalTotal,null);
});
test('explicit zero is retained as evidence and remains distinguishable from absence',()=>{
 const ctx=context();ctx.fbaInventoryCountryLatest=aggregateLatestLedgerByCountry([{producto_id:P,fnsku:'B0GLQKQJWY',asin:'B0GLQKQJWY',physical_country:'DE',location:'DE',snapshot_date:'2026-08-13',condition_type:'NEW',disposition:'SELLABLE',ending_warehouse_balance:0,coverage_valid:true}],'2026-09-30');
 const [de]=buildCountryRowsForProduct(P,ctx);assert.equal(de.stockFbaPhysicalTotal,0);assert.equal(de.stockFbaLedgerSnapshotDate,'2026-08-13');
});
test('UI formats unknown numbers as a dash and explicitly reports missing/partial evidence',()=>{
 const ui=readFileSync(new URL('../components/InventoryPage.tsx',import.meta.url),'utf8');
 assert.match(ui,/if \(n == null \|\| Number.isNaN\(n\)\) return "—"/);
 assert.match(ui,/Sin evidencia Ledger certificada para este producto/);
 assert.match(ui,/pendiente de primera sincronización/);
 assert.match(ui,/la ausencia de un país no demuestra stock cero/);
});
