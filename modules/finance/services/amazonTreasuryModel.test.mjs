import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {expectedBankDateForAvailable,expectedBankDateForPending,projectRemainingMonth,stateContributesFuture} from "./amazonTreasuryModel.ts";

test("AVAILABLE uses the next configured window and bank lag",()=>{
  assert.equal(expectedBankDateForAvailable(new Date("2026-08-11T12:00:00Z"),[1,3],2),"2026-08-14");
});

test("PENDING_BANK uses FundTransferDate plus configured lag without waiting for request weekdays",()=>{
  assert.equal(expectedBankDateForPending("2026-08-11T12:25:33Z",2),"2026-08-13");
  assert.equal(expectedBankDateForPending("2026-08-14T12:25:33Z",2),"2026-08-18");
});

test("FUTURE uses only remaining days, weighted recent rates and stock cap",()=>{
  const value=projectRemainingMonth({now:new Date("2026-08-11T12:00:00Z"),monthStart:"2026-08-01",monthEnd:"2026-08-31",monthlyUnits:310,rate7:12,rate14:10,rate30:8,weekdayRates:[1,1,1,1,1,1,1],stockAvailable:50,unitPrice:20});
  assert.equal(value.daily[0].date,"2026-08-12");assert.ok(value.daily.every(day=>day.date>"2026-08-11"));
  assert.ok(value.forecastUnits<=50);assert.equal(value.amazonExpectedEur,value.estimatedGrossEur);
});

test("economic precedence excludes RECEIVED, negative AVAILABLE and undated DEFERRED",()=>{
  assert.equal(stateContributesFuture("RECEIVED",100,"2026-08-20"),false);
  assert.equal(stateContributesFuture("AVAILABLE",-10,"2026-08-20"),false);
  assert.equal(stateContributesFuture("DEFERRED",100,null,false),false);
  assert.equal(stateContributesFuture("PENDING_BANK",100,"2026-08-20"),true);
});

test("migration preserves exact amounts and identities without automatic cash",async()=>{
  const sql=await readFile(new URL("../../../sql/migrations/20260811_05_amazon_treasury_economic_states.sql",import.meta.url),"utf8");
  assert.match(sql,/amazon_transaction_id/);assert.match(sql,/where amazon_transaction_id is not null/);
  assert.match(sql,/original_amount=round\(p_original_amount,2\)/);assert.doesNotMatch(sql,/p_original_amount\s*\*\s*0\.75/);
  assert.match(sql,/first_seen_deferred_at=case[\s\S]*coalesce\(first_seen_deferred_at,p_snapshot_at\)/);
  assert.match(sql,/economic_state=case when economic_state='DEFERRED' then null/);
  assert.doesNotMatch(sql,/finance_cash_movements|finance_receive_amazon_income/);
});

test("sync never makes Closed Succeeded future or converts foreign amounts silently",async()=>{
  const source=await readFile(new URL("./amazonTreasuryObservations.ts",import.meta.url),"utf8");
  assert.match(source,/FundTransferStatus==="Processing"/);assert.doesNotMatch(source,/FundTransferStatus==="Succeeded"[^\n]*PENDING_BANK/);
  assert.match(source,/expectedRequestDate:pending\?null:dates\.request/);
  assert.match(source,/pending\?expectedBankDateForPending/);
  assert.match(source,/currency==="EUR"/);
  assert.doesNotMatch(source,/data\?\.value\?\?0\.75|gross\*0\.75/);
  assert.match(source,/finance_insert_amazon_treasury_observation|insertAmazonTreasuryObservationAdmin/);
  assert.doesNotMatch(source,/finance_cash_movements|finance_receive_amazon_income/);
});
