// Characterization of demonstrated defects, NOT acceptance tests for a fix.
// Offline: no Amazon calls, database connections, writes or credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildMarketplaceCashCards} from './amazonCashForecast.ts';
import {valueAmazonAmountEur} from './ecbFxService.ts';
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/available-audit-20260910.json',import.meta.url)));
// Mirrors buildFinancialPlanning's source-key selection and amount mapping.
const latest=Array.from(new Map(fixture.rows.slice().sort((a,b)=>a.snapshot_at.localeCompare(b.snapshot_at)).map(r=>[r.source_key,r])).values());
const item=r=>({identity:r.source_key,marketplace:r.marketplace,state:r.economic_state,originalCurrency:r.original_currency,originalAmount:r.original_amount,officialAmountEur:r.official_amount_eur,estimatedAmountEur:r.official_amount_eur==null?r.amount_eur:null,confidence:'medium',estimationMethod:'audit'});
const card=rs=>buildMarketplaceCashCards(rs.map(item));
const synthetic=(id,amount)=>item({source_key:id,marketplace:'ES',economic_state:'AVAILABLE',original_currency:'EUR',original_amount:amount??50,official_amount_eur:amount,amount_eur:amount});
test('100 + 200 + NULL loses known subtotal in current card',()=>{
  const c=buildMarketplaceCashCards([synthetic('a',100),synthetic('b',200),synthetic('c',null)])[0];
  assert.equal(c.availableEur,null);assert.equal(c.availablePositiveEur,null);assert.equal(c.totalEconomicEur,0);
});
test('Europe prefilter removes NULL and hides incompleteness',()=>{
  const rows=[synthetic('a',100),synthetic('b',200),synthetic('c',null)];
  const c=buildMarketplaceCashCards(rows.flatMap(i=>{const amount=i.officialAmountEur??i.estimatedAmountEur;return amount==null?[]:[{...i,marketplace:'EUROPE',originalAmount:amount}]}))[0];
  assert.equal(c.availablePositiveEur,300);
});
test('real Sweden: latest ECB 8.03 survives persistence but old NULL hides country EUR',()=>{
  const recent=latest.find(r=>r.id==='365eb87f');assert.equal(recent.amount_eur,8.03);
  const c=card(latest).find(c=>c.marketplace==='SE');assert.equal(c.availableOriginal,5406.82);assert.equal(c.availablePositiveEur,null);
});
test('real history retained: 17914.98 includes 16865.23 from August',()=>{
  const positive=rs=>rs.filter(r=>r.marketplace!=='UNRESOLVED'&&r.original_amount>0).reduce((s,r)=>s+(r.official_amount_eur??r.amount_eur??0),0);
  assert.equal(Math.round(positive(latest)*100)/100,17914.98);assert.equal(Math.round(positive(latest.filter(r=>r.snapshot_at===fixture.observationTime))*100)/100,1049.75);
  assert.equal(Math.round((positive(latest)-1049.75)*100)/100,16865.23);
});
test('real unresolved positive AED and SAR produce zero in UI fallback',()=>{
  const rs=latest.filter(r=>r.marketplace==='UNRESOLVED');
  assert.ok(rs.some(r=>r.original_currency==='AED'&&r.original_amount===776.31));
  assert.ok(rs.some(r=>r.original_currency==='SAR'&&r.original_amount===369.75));
  const c=card(rs)[0];assert.equal(c.availablePositiveEur,null);
  assert.equal((c.availablePositiveEur??0)+(c.deferredEur??0)+(c.pendingBankEur??0),0);
  assert.equal(c.availableOriginal,1144.26); // Invalid cross-currency sum, reproduced.
});
test('real persisted zero EUR always has zero original in AVAILABLE fixture',()=>{
  const zero=fixture.rows.filter(r=>r.amount_eur===0);assert.ok(zero.length>0);
  assert.ok(zero.every(r=>r.original_amount===0));
});
test('negative Germany is filtered from positive payout, not a conversion failure',()=>{
  const c=card(latest).find(c=>c.marketplace==='DE');assert.equal(c.availableEur,-10415.58);assert.equal(c.availablePositiveEur,0);
});
test('null ConvertedTotal is wrongly accepted as official realized zero (synthetic trigger)',()=>{
  const fx=valueAmazonAmountEur('GBP',100,{CurrencyCode:'EUR',CurrencyAmount:null},null);
  assert.equal(fx.amountEur,0);assert.equal(fx.realizedAmountEur,0);assert.equal(fx.fxSource,'AMAZON_CONVERTED_TOTAL');
});
