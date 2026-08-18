import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {buildSupplierPaymentPlanAmounts} from "../utils/validateSupplierPaymentPlanBase.ts";
import {resolveSupplierPaymentActuals} from "../utils/resolveSupplierPaymentActuals.ts";
import {buildOrderFactoryCostReadModel} from "./buildOrderFactoryCostReadModel.ts";

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<0.011,`${actual} != ${expected}`);
const plan=(currency,total,deposit,fx)=>buildSupplierPaymentPlanAmounts({orderId:"order",originalCurrency:currency,baseOriginal:total,depositPercent:deposit,plannedFxForeignPerEur:fx});

test("EUR planning is 1:1",()=>{const value=plan("EUR",100,30,null);assert.equal(value.deposit?.plannedFxForeignPerEur,1);assert.equal(value.deposit?.amountEur,30);assert.equal(value.balance?.amountEur,70);});
test("USD planning uses 1 EUR = X USD",()=>close(plan("USD",100,30,1.17).deposit?.amountEur??0,30/1.17));
test("CNY planning divides by foreign per EUR",()=>close(plan("CNY",700,20,7.5).balance?.amountEur??0,560/7.5));
for(const deposit of [30,20,40]) test(`deposit ${deposit}/${100-deposit} is data driven`,()=>{const value=plan("USD",100,deposit,1.25);assert.equal(value.deposit?.amountOriginal,deposit);assert.equal(value.balance?.amountOriginal,100-deposit);});
test("different new-order planned FX produces different estimate",()=>assert.notEqual(plan("USD",100,30,1.1).deposit?.amountEur,plan("USD",100,30,1.2).deposit?.amountEur));
test("real deposit and balance retain different execution FX",()=>{const a=resolveSupplierPaymentActuals({amountOriginal:30,currencyOriginal:"USD",actualFxForeignPerEur:0.85});const b=resolveSupplierPaymentActuals({amountOriginal:70,currencyOriginal:"USD",actualFxForeignPerEur:0.88});close(a.actualAmountEur,30/0.85);close(b.actualAmountEur,70/0.88);close(a.actualFxRate,1/0.85);});
test("real cost is allocation EUR sum across obligations",()=>{const result=buildOrderFactoryCostReadModel({orderId:"o",lines:[{id:"l",quantity:10,unitOriginal:10}],obligations:[{id:"d",amountOriginal:30,currency:"USD",plannedFxForeignPerEur:1.2,allocations:[{id:"a",obligationId:"d",batchId:"ba",amountOriginal:30,amountEur:25}]},{id:"b",amountOriginal:70,currency:"USD",plannedFxForeignPerEur:1.2,allocations:[{id:"c",obligationId:"b",batchId:"bb",amountOriginal:70,amountEur:60}]}]});assert.equal(result.realFactoryCostEur,85);assert.equal(result.lines[0].trace.length,2);});
test("partial payment is real paid plus estimated pending",()=>{const result=buildOrderFactoryCostReadModel({orderId:"o",lines:[{id:"l",quantity:10,unitOriginal:10}],obligations:[{id:"d",amountOriginal:100,currency:"USD",plannedFxForeignPerEur:1.25,allocations:[{id:"a",obligationId:"d",batchId:"b1",amountOriginal:25,amountEur:22},{id:"a2",obligationId:"d",batchId:"b2",amountOriginal:25,amountEur:21}]}]});assert.equal(result.realFactoryCostEur,null);close(result.provisionalFactoryCostEur??0,43+50/1.25);assert.equal(result.lines[0].trace.length,2);});
test("foreign obligation without planned FX is never represented as zero debt",()=>{assert.throws(()=>plan("USD",100,30,null),/MISSING_PLANNED_FX/);const result=buildOrderFactoryCostReadModel({orderId:"o",lines:[{id:"l",quantity:1,unitOriginal:100}],obligations:[{id:"d",amountOriginal:100,currency:"USD",plannedFxForeignPerEur:null,allocations:[]}]});assert.equal(result.fxPending,true);assert.equal(result.provisionalFactoryCostEur,null);});
test("migration preserves legacy actual fields and allocations",async()=>{const sql=await readFile(new URL("../../../sql/migrations/20260811_02_separate_planned_and_actual_fx.sql",import.meta.url),"utf8");assert.doesNotMatch(sql,/update public\.finance_purchase_payment_allocations/i);assert.doesNotMatch(sql,/set actual_amount_eur\s*=/i);assert.match(sql,/actual_fx_rate.*LEGACY/i);assert.match(sql,/HISTORICAL_PAYMENT_PLAN_IMMUTABLE/);assert.match(sql,/pg_advisory_xact_lock|finance_execute_supplier_payment\(/);});

const model=({currency="CNY",plannedFx=8,amountOriginal=100,quantity=10,allocations=[],orderId="o"}={})=>buildOrderFactoryCostReadModel({
  orderId,
  lines:[{id:"line",quantity,unitOriginal:amountOriginal/quantity}],
  obligations:[{id:"obligation",amountOriginal,currency,plannedFxForeignPerEur:plannedFx,allocations}],
});
const allocation=(id,batchId,amountOriginal,amountEur)=>({id,obligationId:"obligation",batchId,amountOriginal,amountEur});

test("EUR order paid 100% keeps original and actual EUR one to one",()=>{
  const result=model({currency:"EUR",plannedFx:null,allocations:[allocation("a","b",100,100)]});
  assert.equal(result.estimatedFactoryCostEur,100);
  assert.equal(result.realFactoryCostEur,100);
  assert.equal(result.lines[0].realUnitFactoryCostEur,10);
});

test("CNY order paid 100% derives actual only from allocated EUR",()=>{
  const result=model({currency:"CNY",plannedFx:8,amountOriginal:800,quantity:100,allocations:[allocation("a","b",800,102)]});
  assert.equal(result.estimatedFactoryCostEur,100);
  assert.equal(result.realFactoryCostEur,102);
  assert.equal(result.lines[0].realUnitFactoryCostEur,1.02);
});

test("USD order paid 100% derives actual only from allocated EUR",()=>{
  const result=model({currency:"USD",plannedFx:1.25,amountOriginal:125,quantity:25,allocations:[allocation("a","b",125,104)]});
  assert.equal(result.estimatedFactoryCostEur,100);
  assert.equal(result.realFactoryCostEur,104);
});

test("CNY 30/70 retains two execution FX through allocation EUR",()=>{
  const result=model({amountOriginal:400000,quantity:10000,plannedFx:8,allocations:[
    allocation("deposit","batch-1",120000,120000/7.8),
    allocation("balance","batch-2",280000,280000/7.55),
  ]});
  close(result.realFactoryCostEur,120000/7.8+280000/7.55);
});

test("CNY 20/80 supports non-default payment split",()=>{
  const result=model({amountOriginal:1000,plannedFx:8,allocations:[allocation("a","b1",200,26),allocation("b","b2",800,108)]});
  assert.equal(result.realFactoryCostEur,134);
});

test("three or more payments aggregate allocation EUR exactly once",()=>{
  const result=model({amountOriginal:100,allocations:[allocation("a","b1",20,2.5),allocation("b","b2",30,4),allocation("c","b3",50,7)]});
  assert.equal(result.realFactoryCostEur,13.5);
  assert.equal(result.lines[0].trace.length,3);
});

test("partially allocated execution remains provisional and never final",()=>{
  const result=model({amountOriginal:100,plannedFx:10,allocations:[allocation("a","b",40,5)]});
  assert.equal(result.realFactoryCostEur,null);
  assert.equal(result.provisionalFactoryCostEur,11);
});

test("one batch may allocate to several obligations without counting the batch twice",()=>{
  const result=buildOrderFactoryCostReadModel({orderId:"o",lines:[{id:"line",quantity:10,unitOriginal:10}],obligations:[
    {id:"deposit",amountOriginal:30,currency:"USD",plannedFxForeignPerEur:1.2,allocations:[{id:"a",obligationId:"deposit",batchId:"shared",amountOriginal:30,amountEur:25}]},
    {id:"balance",amountOriginal:70,currency:"USD",plannedFxForeignPerEur:1.2,allocations:[{id:"b",obligationId:"balance",batchId:"shared",amountOriginal:70,amountEur:58}]},
  ]});
  assert.equal(result.realFactoryCostEur,83);
});

test("funding source does not alter factory cost",()=>{
  const cash=model({allocations:[{...allocation("cash","b1",50,7),sourceType:"cash_account"},{...allocation("credit","b2",50,8),sourceType:"credit_line"}]});
  assert.equal(cash.realFactoryCostEur,15);
});

test("actual payment never changes frozen planned FX estimate",()=>{
  const result=model({amountOriginal:800,plannedFx:8,allocations:[allocation("a","b",800,120)]});
  assert.equal(result.estimatedFactoryCostEur,100);
  assert.equal(result.realFactoryCostEur,120);
});

test("historical actual EUR is independent from any later market FX",()=>{
  const historical=model({amountOriginal:800,plannedFx:8,allocations:[allocation("a","b",800,110)]});
  const laterPlan=plan("CNY",800,30,10);
  assert.equal(historical.realFactoryCostEur,110);
  assert.notEqual(laterPlan.deposit?.amountEur,30);
});

test("rounding preserves order total and gives deterministic unit cost",()=>{
  const result=model({amountOriginal:3,quantity:3,plannedFx:3,allocations:[allocation("a","b",3,1)]});
  assert.equal(result.realFactoryCostEur,1);
  assert.equal(result.lines[0].realUnitFactoryCostEur,0.3333);
});

test("same product in historical orders keeps order-scoped actual costs",()=>{
  const first=model({orderId:"old",allocations:[allocation("a","b1",100,12)]});
  const second=model({orderId:"new",allocations:[allocation("a","b2",100,14)]});
  assert.equal(first.realFactoryCostEur,12);
  assert.equal(second.realFactoryCostEur,14);
  assert.notEqual(first.realFactoryCostEur,second.realFactoryCostEur);
});

test("repository excludes reversed batches from realized cost",async()=>{
  const repository=await readFile(new URL("../repositories/orderFactoryCostReadModelRepository.ts",import.meta.url),"utf8");
  assert.match(repository,/status!==\"reversed\"/);
});
