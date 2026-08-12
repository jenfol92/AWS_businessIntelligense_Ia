import test from "node:test";
import assert from "node:assert/strict";
import { resolveDepositDueDate, resolveBalanceDueDate } from "../utils/resolveSupplierPaymentDates.ts";
import { buildSupplierPaymentPlanAmounts } from "../utils/validateSupplierPaymentPlanBase.ts";

test("deposito usa fecha de confirmacion",()=>assert.equal(resolveDepositDueDate({fecha_confirmacion:"2026-08-02",fecha_orden:"2026-08-01"}),"2026-08-02"));
test("AGL usa ETD cuando no hay fecha inbound",()=>assert.equal(resolveBalanceDueDate({logisticsType:"amazon_agl",order:{etd:"2026-09-01"}}),"2026-09-01"));
test("transporte propio resta dias a ETA",()=>assert.equal(resolveBalanceDueDate({logisticsType:"propio",order:{eta:"2026-10-20",balance_dias_antes_eta:5}}),"2026-10-15"));
test("porcentaje configurado conserva dos obligaciones",()=>{const result=buildSupplierPaymentPlanAmounts({orderId:"f1000000-0000-4000-8000-000000000010",originalCurrency:"USD",baseOriginal:20000,depositPercent:25,plannedFxForeignPerEur:1.2});assert.equal(result.deposit?.amountOriginal,5000);assert.equal(result.balance?.amountOriginal,15000);});
