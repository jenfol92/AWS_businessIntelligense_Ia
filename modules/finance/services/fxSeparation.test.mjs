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
