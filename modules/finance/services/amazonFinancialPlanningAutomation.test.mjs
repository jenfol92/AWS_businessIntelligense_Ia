import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=path=>readFile(new URL(`../../../${path}`,import.meta.url),"utf8");

test("freshness skips SP-API while stale data invokes the single synchronizer",async()=>{
  const source=await read("modules/finance/services/financialPlanningAmazonFreshness.ts");
  assert.match(source,/30\*60\*1000/);assert.match(source,/age>=0&&age<AMAZON_FINANCE_FRESHNESS_MS/);
  assert.match(source,/syncAttempted:false/);assert.match(source,/deps\.sync\(\{now\}\)/);
});

test("concurrency uses one leased database lock and concurrent callers use persisted data",async()=>{
  const sql=await read("sql/migrations/20260811_03_amazon_financial_planning_automation.sql");
  const service=await read("modules/finance/services/amazonFinancialPlanningSync.ts");
  assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\('amazon-financial-planning-sync'/);
  assert.match(sql,/locked_until<=now\(\)/);assert.match(service,/skipReason:lock\.acquired\?null:"already_running"/);
});

test("Amazon failure keeps planning available with stale warning",async()=>{
  const freshness=await read("modules/finance/services/financialPlanningAmazonFreshness.ts");
  const route=await read("app/api/finance/planning/route.ts");
  assert.match(freshness,/catch\{return \{stale:true,warning:"AMAZON_FINANCE_SYNC_STALE"/);
  assert.match(route,/buildFinancialPlanning/);assert.match(route,/amazonSync/);
});

test("Amazon forecasts are readable only through the treasury capability",async()=>{
  const sql=await read("sql/migrations/20260811_04_amazon_income_forecasts_read_policy.sql");
  assert.match(sql,/revoke insert, update, delete, truncate, references, trigger/);
  assert.match(sql,/grant select/);
  assert.match(sql,/for select/);
  assert.match(sql,/finance_can_read_treasury\(\)/);
});

test("FUTURE reuses planner forecast, Amazon-only channels and stable monthly identity",async()=>{
  const service=await read("modules/finance/services/amazonFinancialPlanningSync.ts");
  const sql=await read("sql/migrations/20260811_01_amazon_financial_settlement_pipeline.sql");
  assert.match(service,/analyzeProducts/);assert.match(service,/product\.salePrice/);
  assert.match(service,/"AMAZON_FBA"/);assert.match(service,/"AMAZON_FBM"/);assert.doesNotMatch(service,/channel:"ALL"/);
  assert.match(service,/projectRemainingMonth/);assert.match(service,/rate7/);assert.match(service,/rate14/);assert.match(service,/rate30/);
  assert.match(service,/forecast:\$\{marketplace\}:\$\{bounds\.start\}:\$\{bounds\.end\}/);
  assert.match(sql,/lower\(v_row\.status\) not in \('projected','accumulated','previsto'\)/);
  assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\('amazon-income-source:'/);
});

test("Open becomes AVAILABLE, only Closed Processing becomes PENDING_BANK",async()=>{
  const service=await read("modules/finance/services/amazonTreasuryObservations.ts");
  assert.match(service,/ProcessingStatus!=="Open"/);assert.match(service,/FundTransferStatus==="Processing"/);
  assert.match(service,/pending\?"PENDING_BANK":"AVAILABLE"/);
  assert.doesNotMatch(service,/reconcileAmazonSettlementAdmin/);
});

test("automatic sync cannot receive income or write cash",async()=>{
  const service=await read("modules/finance/services/amazonFinancialPlanningSync.ts");
  const observations=await read("modules/finance/services/amazonTreasuryObservations.ts");
  const cron=await read("app/api/cron/amazon-financial-planning/route.ts");
  assert.doesNotMatch(service,/finance_receive_amazon_income|finance_cash_accounts|finance_cash_movements/);
  assert.doesNotMatch(observations,/finance_receive_amazon_income|finance_cash_accounts|finance_cash_movements/);
  assert.doesNotMatch(cron,/finance_receive_amazon_income|finance_cash_accounts|finance_cash_movements/);
  assert.match(cron,/syncAmazonFinancialPlanning/);
});

test("monthly aggregation keeps lifecycle states mutually exclusive",async()=>{
  const planning=await read("modules/finance/services/buildFinancialPlanning.ts");
  const repository=await read("modules/finance/repositories/financialPlanningRepository.ts");
  for(const state of ["FUTURE","DEFERRED","AVAILABLE","PENDING_BANK","RECEIVED","LEGACY_CONFIRMED"])assert.match(planning,new RegExp(state));
  assert.match(planning,/event\.type === "amazon_income" && event\.status !== "pagado"/);
  assert.match(planning,/event\.type==="amazon_income"\?"income"/);
  assert.doesNotMatch(planning,/event\.type!=="amazon_income"/);
  assert.match(planning,/treasury_amount_eur/);assert.match(planning,/expected_bank_date/);
  assert.match(planning,/`\$\{fromMonth\}-01T00:00:00Z`/);
  assert.match(repository,/`\$\{fromMonth\}-01T00:00:00Z`/);
  assert.match(repository,/setUTCDate\(0\)/);
});
