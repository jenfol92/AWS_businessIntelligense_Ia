import test from "node:test";
import assert from "node:assert/strict";
import {getLatestEcbFxTable,parseEcbDailyXml,resetEcbFxCacheForTests,valueAmazonAmountEur as eurAmounts} from "./ecbFxService.ts";
import {buildMarketplaceCashCards,scenarioAmount} from "./amazonCashForecast.ts";

const xml=`<Cube><Cube time='2026-08-11'><Cube currency='GBP' rate='0.8600'/><Cube currency='SEK' rate='11.2000'/><Cube currency='PLN' rate='4.2500'/></Cube></Cube>`;
const table=parseEcbDailyXml(xml,"2026-08-12T08:00:00Z");

test("ECB uses EUR_PER_FOREIGN_UNIT for EUR, GBP, SEK and PLN without changing originals",()=>{
  assert.equal(table.rates.EUR.eurPerForeignUnit,1);
  for(const [currency,amount] of [["GBP",100],["SEK",1000],["PLN",425]]){const original={currency,amount};const result=eurAmounts(currency,amount,undefined,table);assert.equal(result.amountEur,amount*table.rates[currency].eurPerForeignUnit);assert.deepEqual(original,{currency,amount});assert.equal(result.fxSource,"ECB");assert.equal(result.fxObservedAt,"2026-08-11");}
});

test("Amazon ConvertedTotal has absolute precedence and historical realized FX ignores ECB",()=>{const result=eurAmounts("GBP",100,{CurrencyCode:"EUR",CurrencyAmount:117},table,"2026-08-10T10:00:00Z");assert.equal(result.amountEur,117);assert.equal(result.realizedFxRate,1.17);assert.equal(result.fxKind,"AMAZON_REALIZED_FX");assert.equal(result.fxObservedAt,"2026-08-10T10:00:00Z");});
test("missing FX is null, never zero",()=>assert.equal(eurAmounts("XYZ",10,undefined,table).amountEur,null));
test("daily cache prevents repeated ECB requests",async()=>{resetEcbFxCacheForTests();let calls=0;const fetcher=async()=>{calls++;return {ok:true,text:async()=>xml}};await getLatestEcbFxTable({now:new Date("2026-08-12T08:00:00Z"),fetcher});await getLatestEcbFxTable({now:new Date("2026-08-12T18:00:00Z"),fetcher});assert.equal(calls,1);});
test("UI card model keeps original plus estimated EUR and Europe marks ERP estimate",()=>{const base={state:"AVAILABLE",expectedBankDate:null,confidence:"high",estimationMethod:"ecb",officialAmountEur:null,snapshotAt:"2026-08-12",fxSource:"ECB",fxObservedAt:"2026-08-11"};const cards=buildMarketplaceCashCards([{...base,identity:"gb",marketplace:"GB",originalCurrency:"GBP",originalAmount:100,estimatedAmountEur:116,fxRate:1.16},{...base,identity:"se",marketplace:"SE",originalCurrency:"SEK",originalAmount:1000,estimatedAmountEur:90,fxRate:.09}]);assert.equal(cards[0].availableOriginal,100);assert.equal(cards[0].availableEur,116);assert.equal(cards[0].containsEstimatedFx,true);});
test("AVAILABLE and DEFERRED remain outside cash while PENDING_BANK semantics are intact",()=>{const item={identity:"x",marketplace:"GB",originalCurrency:"GBP",originalAmount:10,officialAmountEur:null,estimatedAmountEur:12,expectedBankDate:"2026-08-13",confidence:"high",estimationMethod:"ecb"};assert.equal(scenarioAmount({...item,state:"AVAILABLE"},"base"),0);assert.equal(scenarioAmount({...item,state:"DEFERRED"},"base"),0);assert.equal(scenarioAmount({...item,state:"PENDING_BANK"},"base"),12);});
