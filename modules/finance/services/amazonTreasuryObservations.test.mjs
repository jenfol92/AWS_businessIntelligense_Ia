import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read=path=>readFile(new URL(`../../../${path}`,import.meta.url),"utf8");

test("producer persists the three observational states through the dedicated RPC",async()=>{
  const source=await read("modules/finance/services/amazonTreasuryObservations.ts");const repository=await read("modules/finance/repositories/amazonFinancialPlanningSyncRepository.ts");
  assert.match(await read("modules/finance/services/amazonTreasuryGroupObservation.ts"),/AVAILABLE/);
  assert.match(await read("modules/finance/services/amazonTreasuryGroupObservation.ts"),/PENDING_BANK/);
  assert.match(source,/DEFERRED/);
  assert.match(repository,/finance_insert_amazon_treasury_observation/);assert.match(source,/insertAmazonTreasuryObservationAdmin/);
  assert.match(repository,/p_amazon_release_date/);
  assert.doesNotMatch(source,/finance_receive_amazon_income|finance_cash_movements|finance_cash_accounts/);
});

test("observation key uses UTC day bucket and material hash",async()=>{
  const core=await read("modules/finance/services/amazonTreasuryObservationCore.ts");
  const group=await read("modules/finance/services/amazonTreasuryGroupObservation.ts");
  assert.match(core,/observedAt\.slice\(0,\s*10\)/);assert.match(core,/createHash\("sha256"\)/);assert.match(core,/amazon-observation:v1/);
  assert.match(group,/amount,\s*\r?\n\s*currency,\s*\r?\n\s*marketplace/s);assert.match(group,/fundTransferStatus/);
});

test("AVAILABLE retains negative observations and uses configured weekday only as conditional simulation",async()=>{
  const group=await read("modules/finance/services/amazonTreasuryGroupObservation.ts");
  assert.match(group,/ProcessingStatus\s*!==\s*"Open"/);assert.doesNotMatch(group,/amount\s*<=\s*0[^\n]*return/);
  assert.match(group,/availablePayoutSimulation\(now,\s*weekdays\)/);assert.match(group,/expectedBankDate\s*=\s*pending\s*\?\s*expectedBankDateForPending/);
});

test("PENDING_BANK is only Closed Processing and uses real FundTransferDate",async()=>{
  const group=await read("modules/finance/services/amazonTreasuryGroupObservation.ts");
  assert.match(group,/ProcessingStatus\s*===\s*"Closed"\s*&&\s*group\.FundTransferStatus\s*===\s*"Processing"/);
  assert.match(group,/expectedBankDateForPending\(group\.FundTransferDate\s*\?\?\s*null\)/);assert.match(group,/expectedRequestDate:\s*pending\s*\?\s*null/);
});

test("DEFERRED uses transaction identity, unresolved is explicit, and FX is never zero",async()=>{
  const source=await read("modules/finance/services/amazonTreasuryObservations.ts");
  const deferred=await read("modules/finance/services/amazonTreasuryDeferredFields.ts");
  assert.match(source,/buildDeferredTreasuryObservation/);
  assert.match(deferred,/amazonReleaseDate/);assert.match(deferred,/expectedBankDate:\s*null/);assert.match(deferred,/expectedAvailabilityDate:\s*null/);
  assert.match(deferred,/transactionStatus:\s*"DEFERRED"/);assert.match(deferred,/amazonTransactionId:\s*value\.id/);
  assert.match(await read("modules/finance/services/amazonTreasuryObservationCore.ts"),/"UNRESOLVED"/);
  const fx=await read("modules/finance/services/ecbFxService.ts");assert.match(fx,/fxSource:"UNAVAILABLE"/);assert.match(fx,/amountEur:null,officialAmountEur:null/);assert.doesNotMatch(fx,/amountEur:0|officialAmountEur:0/);
});

test("cron and manual sales endpoint reuse the canonical importer",async()=>{
  const cron=await read("app/api/cron/amazon-sp-api/reports/fba-sales/import/route.ts");const manual=await read("app/api/amazon/reports/fba-sales/import/route.ts");
  assert.match(cron,/importFbaSalesDailyFromSpApi/);assert.match(manual,/importFbaSalesDailyFromSpApi/);assert.match(cron,/setUTCDate\(from\.getUTCDate\(\) - 3\)/);
});
