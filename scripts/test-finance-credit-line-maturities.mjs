import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isFinitePositiveMoney,
  roundMoney,
  FINANCE_MONEY_MAX_AFTER_ROUND,
} from "../modules/finance/utils/financeInputValidation.ts";
import {
  creditLineDrawdownAllowed,
  creditLineRepaymentAllowed,
  isDeletedCreditLineStatus,
  isActiveCreditLineStatus,
} from "../modules/finance/utils/creditLineStatus.ts";

const phase1 = readFileSync(
  new URL("../sql/migrations/20260727_credit_line_maturities_phase1.sql", import.meta.url),
  "utf8",
);
const harden = readFileSync(
  new URL("../sql/migrations/20260728_harden_credit_line_maturity_execution.sql", import.meta.url),
  "utf8",
);
const runtime = readFileSync(
  new URL("../sql/migrations/20260729_close_credit_line_runtime_invariants.sql", import.meta.url),
  "utf8",
);
const legacyMigration = readFileSync(
  new URL("../sql/migrations/20260727_credit_line_legacy_opening_balance_rpc.sql", import.meta.url),
  "utf8",
);
const preflight = readFileSync(
  new URL("../sql/diagnostics/credit_line_maturities_hardening_preflight.sql", import.meta.url),
  "utf8",
);
const migrationOrder = readFileSync(
  new URL("../sql/diagnostics/credit_line_maturities_migration_order.sql", import.meta.url),
  "utf8",
);
const diagnostic = readFileSync(
  new URL("../sql/diagnostics/credit_line_maturities_runtime_diagnostic.sql", import.meta.url),
  "utf8",
);
const planningTypes = readFileSync(
  new URL("../modules/finance/types/planning.types.ts", import.meta.url),
  "utf8",
);
const planning = readFileSync(
  new URL("../modules/finance/services/buildFinancialPlanning.ts", import.meta.url),
  "utf8",
);
const maturitiesService = readFileSync(
  new URL("../modules/finance/services/buildCreditLineMaturities.ts", import.meta.url),
  "utf8",
);
const maturitiesRepo = readFileSync(
  new URL("../modules/finance/repositories/creditLineMaturitiesRepository.ts", import.meta.url),
  "utf8",
);
const maturitiesRoute = readFileSync(
  new URL("../app/api/finance/credit-lines/maturities/route.ts", import.meta.url),
  "utf8",
);
const repayRoute = readFileSync(
  new URL("../app/api/finance/credit-lines/[id]/repay/route.ts", import.meta.url),
  "utf8",
);
const uiSection = readFileSync(
  new URL("../modules/finance/components/CreditLineMaturitiesSection.tsx", import.meta.url),
  "utf8",
);
const planningPage = readFileSync(
  new URL("../modules/finance/components/FinancialPlanningPage.tsx", import.meta.url),
  "utf8",
);
const linkedModal = readFileSync(
  new URL("../modules/finance/components/LinkedPurchasePaymentModal.tsx", import.meta.url),
  "utf8",
);
const ledgerService = readFileSync(
  new URL("../modules/finance/services/creditLineLedgerService.ts", import.meta.url),
  "utf8",
);
const ledgerRepo = readFileSync(
  new URL("../modules/finance/repositories/creditLineLedgerRepository.ts", import.meta.url),
  "utf8",
);
const syncLegacy = readFileSync(
  new URL("../modules/finance/services/syncCreditLineDueFromSupplierPayment.ts", import.meta.url),
  "utf8",
);
const inputValidation = readFileSync(
  new URL("../modules/finance/utils/financeInputValidation.ts", import.meta.url),
  "utf8",
);
const statusUtils = readFileSync(
  new URL("../modules/finance/utils/creditLineStatus.ts", import.meta.url),
  "utf8",
);
const batchService = readFileSync(
  new URL("../modules/finance/services/purchasePaymentBatchService.ts", import.meta.url),
  "utf8",
);
const markService = readFileSync(
  new URL("../modules/finance/services/supplierPaymentExecutionService.ts", import.meta.url),
  "utf8",
);

assert.match(phase1, /finance_create_credit_line_drawdown/);
assert.match(uiSection, /useState\(\(\) => crypto\.randomUUID\(\)\)/);
assert.match(planningPage, /CreditLineMaturitiesSection/);

// DEBT_SUMMARY
assert.match(planningTypes, /totalActiveCreditLimit/);
assert.match(planningTypes, /totalActiveCreditAvailable/);
assert.match(planning, /allCreditLines/);
assert.match(planning, /activeCreditLines/);
assert.match(planning, /totalCreditUsed = allCreditLines\.reduce/);
assert.match(planning, /totalActiveCreditAvailable = activeCreditLines\.reduce/);
assert.match(planning, /creditLines: allCreditLines/);
assert.match(planningPage, /Dispuesto \(todas\)/);
assert.match(planningPage, /Disponible activo/);

{
  const inactive = { usedAmount: 80000, availableAmount: 20000, creditLimit: 100000, status: "cancelada" };
  const active = { usedAmount: 10000, availableAmount: 90000, creditLimit: 100000, status: "activa" };
  const all = [inactive, active];
  const actives = all.filter((l) => isActiveCreditLineStatus(l.status));
  const totalUsed = all.reduce((s, l) => s + l.usedAmount, 0);
  const totalAvail = actives.reduce((s, l) => s + l.availableAmount, 0);
  const totalLimit = actives.reduce((s, l) => s + l.creditLimit, 0);
  assert.equal(totalUsed, 90000);
  assert.equal(totalAvail, 90000);
  assert.equal(totalLimit, 100000);
  assert.ok(totalUsed >= 80000);
}

// LINE_STATUS_SEMANTICS
assert.equal(creditLineRepaymentAllowed("cancelada"), true);
assert.equal(creditLineDrawdownAllowed("cancelada"), false);
assert.equal(creditLineRepaymentAllowed("eliminada"), false);
assert.equal(isDeletedCreditLineStatus("cancelada"), false);
assert.equal(isDeletedCreditLineStatus("eliminada"), true);
assert.match(runtime, /v_line_status IN \('eliminada', 'deleted'\)/);
assert.doesNotMatch(
  runtime,
  /v_line_status IN \('eliminada', 'deleted', 'cancelled', 'cancelada'\)/,
);
assert.match(runtime, /CREDIT_LINE_INACTIVE: credit line must be active for drawdown/);
assert.match(uiSection, /creditLineNonDrawdownDebtLabel/);
assert.match(statusUtils, /no admite nuevas disposiciones, pero su deuda sigue siendo pagable/);
assert.match(planningPage, /creditLineNonDrawdownDebtLabel/);

// NUMERIC limits
assert.match(preflight, /numeric_precision/);
assert.match(preflight, /derived_max_inclusive/);
assert.match(runtime, /9999999999\.9999/);
assert.doesNotMatch(runtime, /1e12/);
assert.match(inputValidation, /FINANCE_MONEY_MAX_AFTER_ROUND/);
assert.equal(isFinitePositiveMoney(FINANCE_MONEY_MAX_AFTER_ROUND), true);
assert.equal(isFinitePositiveMoney(FINANCE_MONEY_MAX_AFTER_ROUND + 0.0001), false);
assert.equal(isFinitePositiveMoney(Number.NaN), false);
assert.equal(isFinitePositiveMoney(Number.POSITIVE_INFINITY), false);
assert.equal(isFinitePositiveMoney(9999999999.99995), false); // rounds to 1e10
assert.equal(roundMoney(1.23456), 1.2346);

// IDEMPOTENCY fallback + global key
assert.match(runtime, /idempotency key belongs to a different movement_type/);
assert.match(runtime, /WHERE idempotency_key = v_key\s*\n\s*LIMIT 1/);
assert.match(runtime, /drawdown source fallback payload differs|IDEMPOTENCY_PAYLOAD_MISMATCH: drawdown source fallback/);
assert.match(runtime, /p_manual_due_date IS NULL[\s\S]*cycle_days IS NULL/);
assert.match(repayRoute, /IDEMPOTENCY_PAYLOAD_MISMATCH[\s\S]*409/);

// AUTHORIZATION
assert.match(runtime, /REVOKE EXECUTE ON FUNCTION public\.finance_create_credit_line_drawdown[\s\S]*FROM PUBLIC, anon, authenticated/);
assert.match(runtime, /GRANT EXECUTE ON FUNCTION public\.finance_create_credit_line_drawdown[\s\S]*TO service_role/);
assert.match(runtime, /source_type must be supplier_payment or purchase_payment_batch/);
assert.match(runtime, /legacy_opening_balance remains on finance_register_legacy_opening_balance|finance_register_legacy_opening_balance/);
assert.match(legacyMigration, /finance_register_legacy_opening_balance/);

// Prior harden contracts still referenced
assert.match(harden, /pg_advisory_xact_lock/);
assert.match(maturitiesRepo, /INTEGRITY_QUERY|integrityQuery/);
assert.match(maturitiesRepo, /purchase_payment_batch/);
assert.match(linkedModal, /manualDueDate/);
assert.match(batchService, /manualDueDate/);
assert.match(markService, /manualDueDate/);
assert.match(ledgerService, /DIRECT_DML_FORBIDDEN/);
assert.match(ledgerRepo, /DIRECT_DML_FORBIDDEN/);
assert.match(syncLegacy, /Intentionally a no-op/);
assert.match(maturitiesRoute, /INVALID_UUID|status: 422/);
assert.match(diagnostic, /outside_six_month_horizon|overdue/);

// Migration inventory generated from files
assert.match(migrationOrder, /AUTO-GENERATED/);
assert.match(migrationOrder, /20260721_supplier_payment_actual_fields\.sql/);
assert.match(migrationOrder, /20260722_linked_purchase_payment_batches\.sql/);
assert.match(migrationOrder, /20260728_harden_credit_line_maturity_execution\.sql/);
assert.match(migrationOrder, /20260729_close_credit_line_runtime_invariants\.sql/);
assert.match(migrationOrder, /supabase_migrations\.schema_migrations/);
assert.match(migrationOrder, /pendiente|aplicado/);

console.log("test-finance-credit-line-maturities: OK");
