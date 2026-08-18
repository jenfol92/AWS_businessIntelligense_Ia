import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const read=path=>readFile(new URL(`../../../${path}`,import.meta.url),"utf8");

test("AVAILABLE cannot mutate cash, RECEIVED, or acquire a guaranteed bank date",async()=>{
  const producer=await read("modules/finance/services/amazonTreasuryObservations.ts");const planning=await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.doesNotMatch(producer,/finance_receive_amazon_income|finance_cash_movements|finance_cash_accounts/);
  assert.match(producer,/expectedBankDate=pending\?expectedBankDateForPending\([^)]*\):null/);
  assert.match(planning,/state==="AVAILABLE"\?null:state==="PENDING_BANK"\?expectedBankDateForPending/);assert.match(planning,/event\.amazonStatus !== "AVAILABLE"/);
});

test("UI distinguishes real cash, AVAILABLE, and PENDING_BANK without technical simulation noise",async()=>{
  const ui=await read("modules/finance/components/FinancialPlanningPage.tsx");
  assert.match(ui,/Caja operativa real/);assert.match(ui,/disponible para solicitar/i);assert.match(ui,/transferencias en curso/i);
  assert.doesNotMatch(ui,/Simulacion condicional|No es una fecha Amazon|Banco esperado/);
});
