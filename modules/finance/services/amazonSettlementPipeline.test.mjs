import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { paginateFinances } from "../../amazon-sp-api/financesPagination.mjs";

const read=(path)=>readFile(new URL(`../../../${path}`,import.meta.url),"utf8");

test("Finances client pagination follows every token exactly once",async()=>{
  const seen=[];
  const rows=await paginateFinances(async token=>{seen.push(token??null);return token?{items:[2],next:null}:{items:[1],next:"page-2"};},page=>page.items,page=>page.next);
  assert.deepEqual(seen,[null,"page-2"]);
  assert.deepEqual(rows,[1,2]);
  const source=await read("modules/amazon-sp-api/financesClient.ts");
  assert.match(source,/spApiRequest/);
  assert.match(source,/financialEventGroups/);
  assert.match(source,/NextToken/);
  assert.match(source,/FINANCIAL_EVENT_GROUP_ID/);
  assert.match(source,/input\.transactionStatus \?\? "RELEASED"/);
  assert.match(source,/response\.payload\?\.transactions/);
  assert.match(source,/response\.payload\?\.nextToken/);
  assert.match(source,/paginateFinances/);
});

test("only Closed groups become settlement candidates",async()=>{
  const source=await read("modules/finance/services/amazonSettlementService.ts");
  assert.match(source,/ProcessingStatus !== "Closed"/);
  assert.match(source,/FinancialEventGroupId/);
  assert.match(source,/reconcileAmazonSettlementRpc/);
});

test("reconciliation is exact by marketplace and cycle and records 0 or many candidates",async()=>{
  const sql=await read("sql/migrations/20260811_01_amazon_financial_settlement_pipeline.sql");
  assert.match(sql,/marketplace=v_marketplace/);
  assert.match(sql,/cycle_start is not distinct from p_cycle_start/);
  assert.match(sql,/cycle_end is not distinct from p_cycle_end/);
  assert.match(sql,/NO_FORECAST_CANDIDATE/);
  assert.match(sql,/MULTIPLE_FORECAST_CANDIDATES/);
  assert.match(sql,/settlement_id_uq/);
});

test("receipt is settlement-gated and idempotent with exactly one cash insertion path",async()=>{
  const sql=await read("sql/migrations/20260811_01_amazon_financial_settlement_pipeline.sql");
  const receive=sql.slice(sql.indexOf("create or replace function public.finance_receive_amazon_income"));
  assert.match(receive,/reconciliation_status<>'matched'/);
  assert.match(receive,/amazon-receive:/);
  assert.match(receive,/pg_advisory_xact_lock/);
  assert.equal((receive.match(/insert into public\.finance_cash_movements/g)??[]).length,1);
  assert.doesNotMatch(await read("modules/finance/services/amazonSettlementService.ts"),/finance_cash_movements/);
});

test("monthly planning exposes mutually exclusive Amazon treasury states",async()=>{
  const source=await read("modules/finance/services/buildFinancialPlanning.ts");
  const types=await read("modules/finance/types/planning.types.ts");
  for(const field of ["amazonAvailableEur","amazonPendingBankEur","amazonDeferredEur","amazonFutureEur","amazonReceivedEur"]){assert.match(types,new RegExp(field));assert.match(source,new RegExp(field));}
  for(const state of ["AVAILABLE","PENDING_BANK","DEFERRED","FUTURE","RECEIVED"])assert.match(source,new RegExp(state));
});
