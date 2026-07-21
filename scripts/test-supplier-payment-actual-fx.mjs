import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSupplierPaymentActuals } from "../modules/finance/utils/resolveSupplierPaymentActuals.ts";
import { buildSupplierPaymentPlanAmounts } from "../modules/finance/utils/validateSupplierPaymentPlanBase.ts";

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

for (const [orderId, currency] of [
  ["order-cny-missing-cost", "CNY"],
  ["order-gbp-missing-cost", "GBP"],
  ["order-zero-total", "EUR"],
]) {
  assert.throws(
    () =>
      buildSupplierPaymentPlanAmounts({
        orderId,
        originalCurrency: currency,
        baseOriginal: 0,
        depositPercent: 30,
      }),
    (error) =>
      error instanceof Error &&
      error.message.includes(orderId) &&
      error.message.includes(currency) &&
      error.message.includes("importe comercial original"),
  );
}
for (const invalidBase of [Number.NaN, Number.POSITIVE_INFINITY, -10]) {
  assert.throws(
    () =>
      buildSupplierPaymentPlanAmounts({
        orderId: "order-invalid-base",
        originalCurrency: "USD",
        baseOriginal: invalidBase,
        depositPercent: 30,
      }),
    /importe comercial original/,
  );
}
for (const depositPercent of [-1, 101, Number.NaN]) {
  assert.throws(
    () =>
      buildSupplierPaymentPlanAmounts({
        orderId: "order-invalid-deposit",
        originalCurrency: "EUR",
        baseOriginal: 1_000,
        depositPercent,
      }),
    /depósito.*entre 0 y 100/,
  );
}
assert.deepEqual(
  buildSupplierPaymentPlanAmounts({
    orderId: "order-valid",
    originalCurrency: "EUR",
    baseOriginal: 1_000,
    depositPercent: 30,
  }),
  {
    deposit: { amountOriginal: 300, amountEur: 300 },
    balance: { amountOriginal: 700, amountEur: 700 },
  },
);

const actualFields = [
  "status",
  "paid_at",
  "amount_original",
  "original_currency",
  "planned_fx_rate",
  "amount_eur",
  "actual_fx_rate",
  "actual_amount_eur",
  "actual_amount_original",
  "bank_reference",
  "bank_fee_eur",
  "ff_fee_eur",
  "payment_source",
  "payment_source_type",
  "cash_account_id",
  "credit_line_id",
  "notes",
  "updated_at",
];

function createPlanSyncHarness(initialRows = []) {
  const rows = new Map(
    initialRows.map((row) => [`${row.orden_id}:${row.payment_type}`, structuredClone(row)]),
  );

  return {
    rows,
    sync(input, beforeLock) {
      if (input.status === "pagado") throw new Error("INVALID_PLAN_STATUS");
      const key = `${input.orden_id}:${input.payment_type}`;
      if (!rows.has(key)) {
        rows.set(key, {
          id: `payment-${rows.size + 1}`,
          ...input,
          notes: input.notes ?? null,
          updated_at: "inserted",
        });
      }
      beforeLock?.(rows.get(key));
      const current = rows.get(key);
      if (current.status === "pagado") return structuredClone(current);
      const next = {
        ...current,
        due_date: input.due_date,
        amount_original: input.amount_original,
        original_currency: input.original_currency,
        planned_fx_rate: input.planned_fx_rate,
        amount_eur: input.amount_eur,
        logistics_type: input.logistics_type,
        contenedor_id: input.contenedor_id,
        status: input.status,
        notes: input.updateNotes ? input.notes ?? null : current.notes,
        updated_at: "updated",
      };
      rows.set(key, next);
      return structuredClone(next);
    },
  };
}

const basePlan = {
  orden_id: "order-sync",
  payment_type: "DEPOSITO_30",
  due_date: "2026-08-01",
  amount_original: 300,
  original_currency: "EUR",
  planned_fx_rate: 1,
  amount_eur: 300,
  logistics_type: "propio",
  contenedor_id: null,
  status: "pendiente",
};
const insertHarness = createPlanSyncHarness();
insertHarness.sync(basePlan);
insertHarness.sync({ ...basePlan, due_date: "2026-08-02" });
assert.equal(insertHarness.rows.size, 1);
assert.equal([...insertHarness.rows.values()][0].due_date, "2026-08-02");
assert.throws(
  () => insertHarness.sync({ ...basePlan, status: "pagado" }),
  /INVALID_PLAN_STATUS/,
);
const notesHarness = createPlanSyncHarness([
  { ...basePlan, id: "notes-pending", notes: "conservar" },
]);
assert.equal(notesHarness.sync({ ...basePlan }).notes, "conservar");
assert.equal(
  notesHarness.sync({ ...basePlan, notes: "sustituir", updateNotes: true }).notes,
  "sustituir",
);
assert.equal(
  notesHarness.sync({ ...basePlan, notes: null, updateNotes: true }).notes,
  null,
);
const overdueHarness = createPlanSyncHarness([
  { ...basePlan, id: "overdue", status: "vencido" },
]);
assert.equal(
  overdueHarness.sync({ ...basePlan, due_date: "2026-10-01" }).due_date,
  "2026-10-01",
);

const paidDeposit = {
  ...basePlan,
  id: "deposit-paid",
  status: "pendiente",
  notes: "nota bancaria",
  paid_at: null,
  actual_fx_rate: null,
  actual_amount_eur: null,
  bank_reference: null,
  bank_fee_eur: null,
  ff_fee_eur: null,
  payment_source: null,
  payment_source_type: null,
  cash_account_id: null,
  credit_line_id: null,
  updated_at: "before-race",
};
const pendingBalance = {
  ...basePlan,
  id: "balance-pending",
  payment_type: "BALANCE_70",
  amount_original: 700,
  amount_eur: 700,
  notes: "nota anterior",
};
const raceHarness = createPlanSyncHarness([paidDeposit, pendingBalance]);
const paidAfterRace = raceHarness.sync(
  { ...basePlan, amount_original: 999, notes: "no sobrescribir", updateNotes: true },
  (row) => {
    Object.assign(row, {
      status: "pagado",
      paid_at: "2026-07-21T00:00:00.000Z",
      actual_fx_rate: 1,
      actual_amount_eur: 300,
      bank_reference: "BANK-1",
      bank_fee_eur: 2,
      ff_fee_eur: 3,
      payment_source: "cash",
      payment_source_type: "cash_account",
      cash_account_id: "cash-1",
      credit_line_id: null,
      notes: "nota bancaria",
      updated_at: "paid",
    });
  },
);
const paidSnapshot = structuredClone(paidAfterRace);
const returnedPaid = raceHarness.sync({ ...basePlan, amount_original: 888 });
assert.deepEqual(returnedPaid, paidSnapshot);
for (const field of actualFields) {
  assert.deepEqual(returnedPaid[field], paidSnapshot[field]);
}
const updatedBalance = raceHarness.sync({
  ...pendingBalance,
  due_date: "2026-09-01",
  status: "vencido",
  notes: "nota recalculada",
  updateNotes: true,
});
assert.equal(updatedBalance.status, "vencido");
assert.equal(updatedBalance.notes, "nota recalculada");

const fieldsSql = read("sql/migrations/20260721_supplier_payment_actual_fields.sql");
const markPaidRpcSql = read("sql/migrations/20260721_supplier_payment_mark_paid_rpc.sql");
const atomicRpcSql = read(
  "sql/migrations/20260721_supplier_payment_t_atomic_pay_finance.sql",
);
const syncRpcSql = read("sql/migrations/20260721_supplier_payment_sync_plan_rpc.sql");
const route = read("app/api/finance/supplier-payments/[id]/mark-paid/route.ts");
const planning = read("modules/finance/services/buildFinancialPlanning.ts");
const planningUi = read("modules/finance/components/FinancialPlanningPage.tsx");
const syncService = read("modules/finance/services/syncSupplierPaymentsForOrder.ts");
const syncRepository = read(
  "modules/finance/repositories/financeSupplierPaymentsRepository.ts",
);
const executionService = read("modules/finance/services/supplierPaymentExecutionService.ts");
const executionTypes = read("modules/finance/types/supplierPaymentExecution.types.ts");
const financeTypes = read("modules/finance/types/supplierPaymentFinance.types.ts");
const financeRpc = read("sql/migrations/finance_supplier_payment_finance_rpc.sql");
const proforma = read("modules/orders/services/orderProformaData.ts");
const diagnostic = read("sql/diagnostics/supplier_payment_actual_fx_validation.sql");
const syncDiagnostic = read(
  "sql/diagnostics/supplier_payment_plan_sync_concurrency_validation.sql",
);

assert.match(fieldsSql, /actual_fx_rate[\s\S]*actual_amount_eur[\s\S]*bank_reference/);
assert.match(fieldsSql, /NOT VALID/);
assert.equal(
  (
    fieldsSql.match(
      /conrelid = 'public\.finance_supplier_payments'::regclass/g,
    ) ?? []
  ).length,
  3,
);
assert.doesNotMatch(fieldsSql, /VALIDATE CONSTRAINT/i);
assert.match(atomicRpcSql, /mark_and_finance_supplier_payment/);
assert.match(atomicRpcSql, /FOR UPDATE/);
assert.match(atomicRpcSql, /SUPPLIER_PAYMENT_ALREADY_PAID/);
assert.match(atomicRpcSql, /p_source_type text/);
assert.match(atomicRpcSql, /'cash_account', 'credit_line'/);
assert.match(atomicRpcSql, /INVALID_SOURCE_TYPE: manual funding is not allowed/);
assert.match(atomicRpcSql, /finance_create_credit_line_drawdown/);
assert.match(atomicRpcSql, /INSERT INTO public\.finance_cash_movements/);
assert.match(atomicRpcSql, /require_real_funding_on_supplier_payment_paid/);
assert.match(atomicRpcSql, /MISSING_FUNDING_SOURCE: use mark_and_finance_supplier_payment/);
assert.match(atomicRpcSql, /SECURITY INVOKER/);
assert.match(atomicRpcSql, /REVOKE EXECUTE[\s\S]*FROM PUBLIC/);
assert.match(atomicRpcSql, /GRANT EXECUTE[\s\S]*authenticated, service_role/);
assert.match(markPaidRpcSql, /mark_supplier_payment_paid/);
assert.match(route, /markAndFinanceSupplierPaymentRpc\(value, supabase\)/);
assert.match(route, /auth\.getUser\(\)/);
assert.match(route, /status:\s*401/);
assert.doesNotMatch(route, /\.from\("finance_supplier_payments"\)\s*\.update/);
assert.match(executionService, /sourceType debe ser cash_account o credit_line/);
assert.match(executionService, /payload\.sourceType === "manual"/);
assert.match(executionService, /MISSING_CASH_ACCOUNT/);
assert.match(executionService, /MISSING_CREDIT_LINE/);
assert.match(executionService, /SUPPLIER_PAYMENT_ALREADY_PAID:\s*409/);
assert.doesNotMatch(executionTypes, /paymentSource:\s*"cash"/);
assert.match(executionTypes, /sourceType: SupplierPaymentFundingSourceType/);
assert.doesNotMatch(financeTypes, /\|\s*"manual"/);
assert.match(
  route,
  /const input = normalizeMarkSupplierPaymentPaidInput[\s\S]*markSupplierPaymentPaid/,
);
const paidRealEurBlock = planning.slice(
  planning.indexOf("function paidRealAmountEur"),
  planning.indexOf("function paidRealAmountOriginal"),
);
assert.doesNotMatch(paidRealEurBlock, /payment\["amount_eur"\]/);
assert.match(planningUi, /Pendiente de pago/);
assert.match(planningUi, /Fuente financiera/);
assert.match(planningUi, /sourceType/);
assert.match(planningUi, /cashAccountId/);
assert.match(planningUi, /creditLineId/);
assert.doesNotMatch(planningUi, /PAYMENT_SOURCE_OPTIONS|value:\s*"caja_rural"|value:\s*"manual"/);
assert.doesNotMatch(planningUi, /Corregir pago|mode:\s*"replace"|actualAmountOriginal:/);
assert.match(syncService, /planned_fx_rate:\s*null/);
assert.match(syncService, /buildSupplierPaymentPlanAmounts/);
assert.match(syncService, /if \(planAmounts\.deposit\)/);
assert.match(syncService, /if \(planAmounts\.balance\)/);
assert.doesNotMatch(syncService, /tipo_cambio_moneda_eur|tipo_cambio_usd_eur/);
assert.match(syncRepository, /\.rpc\("sync_supplier_payment_plan"/);
assert.doesNotMatch(
  syncRepository.slice(
    syncRepository.indexOf("export async function upsertSupplierPayment"),
    syncRepository.indexOf("export async function voidPendingSupplierPaymentsForOrder"),
  ),
  /fetchSupplierPaymentByType|\.from\("finance_supplier_payments"\)|status:\s*"pagado"/,
);
assert.match(syncRepository, /status:\s*"pendiente" \| "vencido"/);
assert.match(syncRepository, /p_update_notes:\s*input\.notes !== undefined/);
assert.match(syncRpcSql, /ON CONFLICT \(orden_id, payment_type\) DO NOTHING/);
assert.match(syncRpcSql, /FOR UPDATE/);
assert.match(syncRpcSql, /IF v_payment\.status = 'pagado' THEN[\s\S]*RETURN v_payment/);
assert.match(syncRpcSql, /notes = CASE WHEN p_update_notes THEN p_notes ELSE notes END/);
assert.match(syncRpcSql, /SECURITY INVOKER/);
assert.match(syncRpcSql, /REVOKE EXECUTE[\s\S]*FROM PUBLIC/);
assert.match(syncRpcSql, /GRANT EXECUTE[\s\S]*authenticated, service_role/);
assert.doesNotMatch(
  syncRpcSql.slice(syncRpcSql.indexOf("UPDATE public.finance_supplier_payments")),
  /paid_at\s*=|actual_fx_rate\s*=|actual_amount_eur\s*=|bank_reference\s*=|bank_fee_eur\s*=|ff_fee_eur\s*=|payment_source\s*=|payment_source_type\s*=|cash_account_id\s*=|credit_line_id\s*=|actual_amount_original\s*=/,
);
assert.doesNotMatch(
  financeRpc,
  /coalesce\(v_payment\.actual_amount_eur, v_payment\.amount_eur\)/,
);
assert.match(financeRpc, /UNVERIFIED_ACTUAL_AMOUNT/);
assert.doesNotMatch(proforma, /actual_fx_rate|actual_amount_eur|planned_fx_rate|amount_eur/);
assert.match(diagnostic, /^BEGIN;/m);
assert.match(diagnostic, /ROLLBACK;\s*$/);
assert.doesNotMatch(diagnostic, /^\s*COMMIT;/m);
assert.match(diagnostic, /mark_and_finance_supplier_payment/);
assert.match(diagnostic, /test_cash_account_id/);
assert.doesNotMatch(diagnostic, /payment_source_type = 'manual'/);
assert.match(
  diagnostic,
  /La repetición sobre un pago pagado no fue rechazada \(conflicto de sobrescritura\)/,
);
assert.match(diagnostic, /La fuente manual no fue rechazada/);
assert.match(diagnostic, /El trigger permitió financiar sin importe EUR real/);
assert.match(syncDiagnostic, /^BEGIN;/m);
assert.match(syncDiagnostic, /ROLLBACK;\s*$/);
assert.doesNotMatch(syncDiagnostic, /^\s*COMMIT;/m);
assert.match(syncDiagnostic, /test_cash_account_id/);
assert.doesNotMatch(syncDiagnostic, /payment_source_type = 'manual'/);
assert.match(syncDiagnostic, /_supplier_payment_paid_snapshot/);
assert.match(syncDiagnostic, /_supplier_payment_pending_snapshot/);
assert.match(syncDiagnostic, /PENDING_PAYMENT_NOT_UPDATED|PAID_PAYMENT_CHANGED/);
assert.equal(
  (
    syncDiagnostic.match(/public\.sync_supplier_payment_plan\(/g) ?? []
  ).length,
  4,
);

console.log("supplier payment actual FX assertions: ok");
