import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketplaceCashCards, calculateReleaseLagStats, calculateTwinlyShares, cashDateFromSale, estimateEur, exclusiveAmazonCashItems, isTwinlyProduct, scenarioAmount, summarizeAmazonCashByMonth } from "./amazonCashForecast.ts";

const item=(patch={})=>({identity:"x",marketplace:"ES",state:"AVAILABLE",originalCurrency:"EUR",originalAmount:100,officialAmountEur:100,estimatedAmountEur:null,expectedBankDate:"2026-08-26",confidence:"high",estimationMethod:"amazon",...patch});

test("Twinly is canonical brand plus SKU or ASIN, never financial text",()=>{
  assert.equal(isTwinlyProduct({brand:" Twinly ",sku:"SKU-1"}),true);
  assert.equal(isTwinlyProduct({brand:"Other",sku:"TWINLY-SKU"}),false);
  assert.equal(isTwinlyProduct({brand:"Twinly"}),false);
});

test("Twinly share is dynamic for 7/30/60/90 and Europe",()=>{
  const rows=[
    {date:"2026-08-10",marketplace:"ES",productId:"1",sku:"A",asin:null,brand:"Twinly",units:3,revenueEur:60},
    {date:"2026-08-10",marketplace:"ES",productId:"2",sku:"B",asin:null,brand:"Other",units:1,revenueEur:40},
  ];
  const shares=calculateTwinlyShares(rows,new Date("2026-08-11T00:00:00Z"));
  assert.equal(shares.length,8);assert.equal(shares.find(v=>v.marketplace==="ES"&&v.windowDays===7)?.unitShare,.75);assert.equal(shares.find(v=>v.marketplace==="EUROPE"&&v.windowDays===30)?.revenueShare,.6);
});

test("release history uses unique transactions and observed percentiles",()=>{
  const stats=calculateReleaseLagStats([2,4,6,8].map((days,index)=>({transactionId:String(index),marketplace:"FR",deferredPostedAt:"2026-07-01",releasedPostedAt:`2026-07-${String(1+days).padStart(2,"0")}`})))[0];
  assert.deepEqual(stats,{marketplace:"FR",samples:4,p50Days:4,p75Days:6,p90Days:8});
});

test("FX estimated is separate and official EUR wins",()=>{
  assert.deepEqual(estimateEur({originalAmount:100,originalCurrency:"GBP",estimatedForeignPerEur:.8}),{amountEur:125,kind:"estimated"});
  assert.deepEqual(estimateEur({originalAmount:100,originalCurrency:"SEK"}),{amountEur:null,kind:"unvalued"});
  assert.deepEqual(estimateEur({originalAmount:100,originalCurrency:"AED",officialAmountEur:25,estimatedForeignPerEur:4}),{amountEur:25,kind:"official"});
});

test("sale cash date uses release, configured request weekday and bank lag",()=>{
  assert.equal(cashDateFromSale({expectedSaleDate:"2026-08-03",releaseLagDays:5,requestWeekdays:[1,3],bankLagDays:12}),"2026-08-26");
  assert.equal(cashDateFromSale({expectedSaleDate:"2026-08-03",releaseLagDays:null,requestWeekdays:[1,3],bankLagDays:12}),null);
});

test("economic precedence removes Open/Deferred duplicates and RECEIVED future",()=>{
  const rows=exclusiveAmazonCashItems([item({state:"DEFERRED"}),item({state:"AVAILABLE"}),item({state:"PENDING_BANK"})]);
  assert.equal(rows.length,1);assert.equal(rows[0].state,"PENDING_BANK");
  assert.equal(scenarioAmount(item({state:"RECEIVED"}),"base"),0);
});

test("AVAILABLE is mobilizable liquidity, never automatic bank cash",()=>{
  assert.equal(scenarioAmount(item({state:"AVAILABLE",officialAmountEur:100}),"base"),0);
  assert.equal(scenarioAmount(item({state:"PENDING_BANK",officialAmountEur:100}),"conservative"),100);
  assert.equal(scenarioAmount(item({state:"AVAILABLE",officialAmountEur:-10,originalAmount:-10}),"base"),0);
});

test("cards separate AVAILABLE conditional dates from PENDING_BANK actual request",()=>{
  const [card]=buildMarketplaceCashCards([item({identity:"a",state:"AVAILABLE",expectedRequestDate:"2026-08-12"}),item({identity:"p",state:"PENDING_BANK",actualRequestDate:"2026-08-11T09:00:00Z",expectedBankDate:"2026-08-12"})]);
  assert.equal(card.expectedBankDate,"2026-08-12");assert.equal(card.availableExpectedRequestDate,"2026-08-12");
  assert.equal(card.availableArrivalBase,"2026-08-13");assert.equal(card.availableArrivalConservative,"2026-08-14");assert.equal(card.availableTiming,"ESTIMATED_CONDITIONAL");
  assert.equal(card.pendingBankArrivalBase,"2026-08-12");assert.equal(card.pendingBankArrivalConservative,"2026-08-13");
});

test("DEFERRED and FUTURE are unavailable without evidence-derived scenarios",()=>{
  assert.equal(scenarioAmount(item({state:"DEFERRED"}),"base"),0);
  assert.equal(scenarioAmount(item({state:"FUTURE"}),"optimistic"),0);
  assert.equal(scenarioAmount(item({state:"DEFERRED",scenarioAmountsEur:{base:82}}),"base"),82);
});

test("DEFERRED is distributed only by expectedBankDate and not entirely current month",()=>{
  const rows=[item({identity:"a",state:"DEFERRED",expectedBankDate:"2026-08-28"}),item({identity:"b",state:"DEFERRED",expectedBankDate:"2026-09-10"})];
  const summary=summarizeAmazonCashByMonth(rows,["2026-08","2026-09"]);
  assert.equal(summary[0].base,0);assert.equal(summary[1].base,0);
});

test("marketplace cards keep original and estimated EUR separated without duplicate states",()=>{
  const cards=buildMarketplaceCashCards([item({identity:"a",marketplace:"SE",state:"AVAILABLE",originalCurrency:"SEK",originalAmount:1000,officialAmountEur:null,estimatedAmountEur:90}),item({identity:"a",marketplace:"SE",state:"DEFERRED",originalCurrency:"SEK",originalAmount:1000,officialAmountEur:null,estimatedAmountEur:90})]);
  assert.equal(cards[0].availableEur,90);assert.equal(cards[0].deferredOriginal,0);assert.equal(cards[0].totalEconomicEur,90);
});
