import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSupplierPaymentActuals } from "../modules/finance/utils/resolveSupplierPaymentActuals.ts";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

assert.deepEqual(
  resolveSupplierPaymentActuals({
    amountOriginal: 100,
    currencyOriginal: "EUR",
  }),
  { actualFxRate: 1, actualAmountEur: 100 },
);
assert.deepEqual(
  resolveSupplierPaymentActuals({
    amountOriginal: 30_000,
    currencyOriginal: "CNY",
    actualFxRate: 0.126,
  }),
  { actualFxRate: 0.126, actualAmountEur: 3_780 },
);
assert.deepEqual(
  resolveSupplierPaymentActuals({
    amountOriginal: 70_000,
    currencyOriginal: "CNY",
    actualAmountEur: 8_540,
  }),
  { actualFxRate: 0.122, actualAmountEur: 8_540 },
);
assert.deepEqual(
  resolveSupplierPaymentActuals({
    amountOriginal: 1_000,
    currencyOriginal: "USD",
    actualFxRate: 0.92,
    actualAmountEur: 920.01,
  }),
  { actualFxRate: 0.92, actualAmountEur: 920.01 },
);
assert.throws(
  () =>
    resolveSupplierPaymentActuals({
      amountOriginal: 1_000,
      currencyOriginal: "USD",
      actualFxRate: 0.92,
      actualAmountEur: 930,
    }),
  /INCONSISTENT_ACTUAL_VALUES/,
);

for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.throws(
    () =>
      resolveSupplierPaymentActuals({
        amountOriginal: 100,
        currencyOriginal: "USD",
        actualFxRate: invalid,
      }),
    /INVALID_ACTUAL_FX_RATE/,
  );
  assert.throws(
    () =>
      resolveSupplierPaymentActuals({
        amountOriginal: 100,
        currencyOriginal: "USD",
        actualAmountEur: invalid,
      }),
    /INVALID_ACTUAL_AMOUNT_EUR/,
  );
}
assert.throws(
  () =>
    resolveSupplierPaymentActuals({
      amountOriginal: 100,
      currencyOriginal: "USD",
    }),
  /MISSING_ACTUAL_VALUE/,
);

const fieldsSql = read("sql/migrations/20260721_supplier_payment_actual_fields.sql");
const rpcSql = read("sql/migrations/20260721_mark_supplier_payment_paid_rpc.sql");
const route = read("app/api/finance/supplier-payments/[id]/mark-paid/route.ts");
const planning = read("modules/finance/services/buildFinancialPlanning.ts");
const planningUi = read("modules/finance/components/FinancialPlanningPage.tsx");
const syncService = read("modules/finance/services/syncSupplierPaymentsForOrder.ts");
const executionService = read("modules/finance/services/supplierPaymentExecutionService.ts");
const proforma = read("modules/orders/services/orderProformaData.ts");
const diagnostic = read("sql/diagnostics/supplier_payment_actual_fx_validation.sql");

assert.match(fieldsSql, /actual_fx_rate[\s\S]*actual_amount_eur[\s\S]*bank_reference/);
assert.match(fieldsSql, /NOT VALID/);
assert.doesNotMatch(fieldsSql, /UPDATE\s+public\.finance_supplier_payments/i);
assert.match(rpcSql, /FOR UPDATE/);
assert.match(rpcSql, /SUPPLIER_PAYMENT_ALREADY_PAID/);
assert.match(rpcSql, /PAYMENT_ORDER_MISMATCH/);
assert.match(rpcSql, /round\(v_payment\.amount_original \* p_actual_fx_rate, 2\)/);
assert.match(rpcSql, /abs\(v_expected_amount_eur - round\(p_actual_amount_eur, 2\)\) > 0\.01/);
assert.match(rpcSql, /WHERE id = v_payment\.id/);
assert.doesNotMatch(rpcSql, /SET[\s\S]{0,300}amount_original\s*=/);
assert.doesNotMatch(rpcSql, /UPDATE public\.orden_items|order_proforma_versions/);
assert.match(rpcSql, /SECURITY INVOKER/);
assert.match(rpcSql, /REVOKE EXECUTE[\s\S]*FROM PUBLIC/);
assert.match(rpcSql, /GRANT EXECUTE[\s\S]*authenticated, service_role/);
assert.match(route, /markSupplierPaymentPaidRpc\(value, supabase\)/);
assert.doesNotMatch(route, /\.from\("finance_supplier_payments"\)\s*\.update/);
assert.match(executionService, /Number\.isFinite\(parsed\)/);
assert.match(executionService, /date\.toISOString\(\)\.slice\(0, 10\) !== value/);
const paidRealEurBlock = planning.slice(
  planning.indexOf("function paidRealAmountEur"),
  planning.indexOf("function paidRealAmountOriginal"),
);
assert.doesNotMatch(paidRealEurBlock, /payment\["amount_eur"\]/);
assert.match(planningUi, /Pendiente de pago/);
assert.match(planningUi, /Legacy no verificado/);
assert.doesNotMatch(planningUi, /Corregir pago|mode:\s*"replace"|actualAmountOriginal:/);
assert.match(syncService, /planned_fx_rate:\s*null/);
assert.match(syncService, /amount_eur:\s*legacyAmountEur/);
assert.doesNotMatch(syncService, /tipo_cambio_moneda_eur|tipo_cambio_usd_eur/);
assert.doesNotMatch(proforma, /actual_fx_rate|actual_amount_eur|planned_fx_rate|amount_eur/);
assert.match(diagnostic, /^BEGIN;/m);
assert.match(diagnostic, /ROLLBACK;\s*$/);
assert.doesNotMatch(diagnostic, /^\s*COMMIT;/m);

console.log("supplier payment actual FX assertions: ok");
