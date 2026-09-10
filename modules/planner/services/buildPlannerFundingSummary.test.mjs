import assert from "node:assert/strict";
import test from "node:test";
import { buildPlannerFundingSummary } from "./buildPlannerFundingSummary.ts";

test("protege reserva y usa credito solo despues de caja operativa",()=>{
  const result=buildPlannerFundingSummary({purchaseCapitalRequired:90000,capitalAlreadyCommitted:20000,operatingCashAvailableAboveReserveEur:60000,totalCreditAvailableEur:50000,amazonExpectedEur:15000});
  assert.equal(result.fundingStatus,"CREDIT_REQUIRED");
  assert.equal(result.immediateFundingCapacityEur,110000);
  assert.equal(result.uncoveredImmediateNeedEur,0);
  assert.equal(result.suggestedNewProductBudgetEur,2000);
});

test("no asigna presupuesto nuevo cuando falta financiar reposicion",()=>{
  const result=buildPlannerFundingSummary({purchaseCapitalRequired:140000,capitalAlreadyCommitted:0,operatingCashAvailableAboveReserveEur:40000,totalCreditAvailableEur:50000,amazonExpectedEur:30000});
  assert.equal(result.fundingStatus,"FUNDING_GAP");
  assert.equal(result.uncoveredImmediateNeedEur,50000);
  assert.equal(result.suggestedNewProductBudgetEur,0);
});
