import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read=path=>readFile(new URL(`../../../${path}`,import.meta.url),"utf8");

test("producer persists the three observational states through the dedicated RPC",async()=>{
  const source=await read("modules/finance/services/amazonTreasuryObservations.ts");const repository=await read("modules/finance/repositories/amazonFinancialPlanningSyncRepository.ts");
  for(const state of ["AVAILABLE","PENDING_BANK","DEFERRED"])assert.match(source,new RegExp(state));
  assert.match(repository,/finance_insert_amazon_treasury_observation/);assert.match(source,/insertAmazonTreasuryObservationAdmin/);
  assert.doesNotMatch(source,/finance_receive_amazon_income|finance_cash_movements|finance_cash_accounts/);
});

test("observation key uses UTC day bucket and material hash",async()=>{
  const source=await read("modules/finance/services/amazonTreasuryObservations.ts");
  assert.match(source,/observedAt\.slice\(0,10\)/);assert.match(source,/createHash\("sha256"\)/);assert.match(source,/amazon-observation:v1/);
  assert.match(source,/amount,currency,marketplace/);assert.match(source,/fundTransferStatus/);
});

test("AVAILABLE retains negative observations and uses configured weekday plus lag",async()=>{
  const source=await read("modules/finance/services/amazonTreasuryObservations.ts");
  assert.match(source,/ProcessingStatus!=="Open"/);assert.doesNotMatch(source,/amount\s*<=\s*0[^\n]*return/);
  assert.match(source,/nextTransferRequestDate\(now,weekdays\)/);assert.match(source,/addBusinessDays\(request,lag\)/);
});

test("PENDING_BANK is only Closed Processing and uses FundTransferDate plus lag",async()=>{
  const source=await read("modules/finance/services/amazonTreasuryObservations.ts");
  assert.match(source,/ProcessingStatus==="Closed"&&group\.FundTransferStatus==="Processing"/);
  assert.match(source,/expectedBankDateForPending\(group\.FundTransferDate\?\?null,lag\)/);assert.match(source,/expectedRequestDate:pending\?null/);
});

test("DEFERRED uses transaction identity, unresolved is explicit, and FX is never zero",async()=>{
  const source=await read("modules/finance/services/amazonTreasuryObservations.ts");
  assert.match(source,/transactionStatus:"DEFERRED"/);assert.match(source,/amazonTransactionId:value\.id/);assert.match(source,/"UNRESOLVED"/);
  assert.match(source,/fxSource:"unavailable"/);assert.match(source,/amountEur:null,officialAmountEur:null/);assert.doesNotMatch(source,/amountEur:0|officialAmountEur:0/);
});

test("cron and manual sales endpoint reuse the canonical importer",async()=>{
  const cron=await read("app/api/cron/amazon-sp-api/reports/fba-sales/import/route.ts");const manual=await read("app/api/amazon/reports/fba-sales/import/route.ts");
  assert.match(cron,/importFbaSalesDailyFromSpApi/);assert.match(manual,/importFbaSalesDailyFromSpApi/);assert.match(cron,/setUTCDate\(from\.getUTCDate\(\) - 3\)/);
});
