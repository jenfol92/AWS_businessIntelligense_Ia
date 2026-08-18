import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const ui=await readFile(new URL("../components/FinancialPlanningPage.tsx",import.meta.url),"utf8");

test("liquidity UI keeps marketplace, EUROPE, UNRESOLVED and real pending transfers",()=>{
  assert.match(ui,/marketplaceAmazonCards\.map/);assert.match(ui,/Europa · equivalente EUR estimado/);assert.match(ui,/>UNRESOLVED</);
  assert.match(ui,/Sin importes pendientes de asignar/);assert.match(ui,/Pendientes de asignar/);
  assert.match(ui,/Próximas transferencias en curso/);assert.match(ui,/PENDING_BANK/);
  assert.match(ui,/pendingBankCards/);assert.match(ui,/card\.marketplace !== "UNRESOLVED"/);
});

test("main Amazon view omits cadence, explainer, legend and orientative forecast",()=>{
  assert.doesNotMatch(ui,/Cadencia de solicitud configurada|Configurar días preferidos|¿Qué significan los estados\?|Previsión orientativa \(si solicitas\)/);
  assert.doesNotMatch(ui,/data\.amazonCashForecast\.monthlyScenarios\.map/);
  assert.doesNotMatch(ui,/Simulacion condicional: si se solicita|No es una fecha Amazon|No reconciliado en tiempo real con Seller Central/);
});
