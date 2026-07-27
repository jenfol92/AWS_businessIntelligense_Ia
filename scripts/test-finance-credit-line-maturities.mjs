import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const phase1 = readFileSync(
  new URL("../sql/migrations/20260727_credit_line_maturities_phase1.sql", import.meta.url),
  "utf8",
);
const harden = readFileSync(
  new URL("../sql/migrations/20260728_harden_credit_line_maturity_execution.sql", import.meta.url),
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
const batchService = readFileSync(
  new URL("../modules/finance/services/purchasePaymentBatchService.ts", import.meta.url),
  "utf8",
);
const markService = readFileSync(
  new URL("../modules/finance/services/supplierPaymentExecutionService.ts", import.meta.url),
  "utf8",
);

// --- Phase1 baseline contracts still present ---
assert.match(phase1, /finance_create_credit_line_drawdown/);
assert.match(phase1, /MANUAL_DUE_DATE_REQUIRED/);
assert.match(maturitiesService, /next_7|next_15|this_month|overdue/);
assert.match(planningTypes, /credit_line_maturity/);
assert.match(uiSection, /useState\(""\)/);
assert.match(uiSection, /currency\.trim\(\)\.toUpperCase\(\) === "EUR"/);
assert.match(planningPage, /CreditLineMaturitiesSection/);

// 1 Full repayment retry returns idempotent=true (order: lock → find → return even if paid)
assert.match(harden, /pg_advisory_xact_lock\(hashtextextended\('credit_line_repay:'/);
assert.match(harden, /idempotent',\s*true/);
assert.match(
  harden,
  /IF FOUND THEN[\s\S]*IDEMPOTENCY_PAYLOAD_MISMATCH[\s\S]*idempotent',\s*true/,
);

// 2 Same key other line rejected
assert.match(harden, /v_existing\.credit_line_id <> p_credit_line_id/);
assert.match(harden, /IDEMPOTENCY_PAYLOAD_MISMATCH: repayment idempotency payload differs/);

// 3 Same key other amount rejected
assert.match(harden, /round\(v_existing\.amount, 4\) <> v_amount/);

// 4 Concurrency: advisory lock + unique partial index (preflight first)
assert.match(harden, /ux_finance_credit_line_movements_idempotency_key/);
assert.match(preflight, /duplicate|idempotency/i);

// 5 Inactive line with debt can be repaid
assert.match(harden, /eliminada|deleted|cancelled|cancelada/);
assert.doesNotMatch(
  harden,
  /CREATE OR REPLACE FUNCTION public\.finance_create_credit_line_repayment[\s\S]*?CREDIT_LINE_INACTIVE: credit line must be active/,
);
assert.match(maturitiesService, /lineAllowsDrawdown/);
assert.match(maturitiesService, /canRepay: group\.remaining_amount > 0/);
assert.match(uiSection, /deuda pagable/);

// 6 Inactive line cannot drawdown
assert.match(harden, /CREDIT_LINE_INACTIVE: credit line must be active for drawdown/);

// 7 Second identical partial from new modal → new UUID key
assert.match(uiSection, /useState\(\(\) => crypto\.randomUUID\(\)\)/);
assert.doesNotMatch(uiSection, /credit-line-repayment:\$\{/);

// 8-9 Manual due date from individual + linked payment
assert.match(planningPage, /Fecha de vencimiento de la disposición/);
assert.match(planningPage, /manualDueDate/);
assert.match(linkedModal, /Fecha de vencimiento de la disposición/);
assert.match(linkedModal, /manualDueDate/);
assert.match(batchService, /manualDueDate/);
assert.match(markService, /manualDueDate/);
assert.match(harden, /manual_due_date/);
assert.match(harden, /p_manual_due_date/);

// 10 Absence of date → MANUAL_DUE_DATE_REQUIRED (rollback at RPC)
assert.match(harden, /MANUAL_DUE_DATE_REQUIRED/);
assert.match(batchService, /MANUAL_DUE_DATE_REQUIRED:\s*422/);
assert.match(markService, /MANUAL_DUE_DATE_REQUIRED:\s*422/);

// 11 Date filter does not create false legacy gaps
assert.match(maturitiesRepo, /INTEGRITY_QUERY/);
assert.match(maturitiesRepo, /integrityQuery/);
assert.doesNotMatch(
  maturitiesRepo.split("let integrityQuery")[1]?.split("let linesQuery")[0] ?? "",
  /\.gte\("due_date"|\.lte\("due_date"/,
);

// 12 creditLineId filter scopes gaps
assert.match(
  maturitiesRepo.split("let integrityQuery")[1]?.split("let linesQuery")[0] ?? "",
  /query\.creditLineId/,
);
assert.match(
  maturitiesRepo.split("let linesQuery")[1]?.split("const [groupsResult")[0] ?? "",
  /query\.creditLineId/,
);

// 13 Batch multi-order trace
assert.match(maturitiesRepo, /purchase_payment_batch/);
assert.match(maturitiesRepo, /finance_purchase_payment_allocations/);
assert.match(maturitiesRepo, /financed_order_codes/);

// 14 Non-existent date → 422
assert.match(inputValidation, /isRealIsoDate/);
assert.match(maturitiesRoute, /status: 422/);
assert.match(repayRoute, /status: 422/);
assert.match(inputValidation, /parsed\.toISOString\(\)\.slice\(0, 10\) === value/);

// 15 Invalid UUID → 422
assert.match(repayRoute, /INVALID_UUID/);
assert.match(maturitiesRoute, /INVALID_UUID/);

// 16 NaN / out of range rejected in SQL helper + TS
assert.match(harden, /finance_assert_finite_money/);
assert.match(harden, /'NaN'|is nan|<> amount/i);
assert.match(inputValidation, /isFinitePositiveMoney/);
assert.match(inputValidation, /Number\.isFinite\(value\)/);

// 17 No operative direct DML consumers
assert.match(ledgerService, /DIRECT_DML_FORBIDDEN/);
assert.match(ledgerRepo, /DIRECT_DML_FORBIDDEN/);
assert.match(syncLegacy, /Intentionally a no-op/);
assert.doesNotMatch(syncLegacy, /\.insert\(/);
assert.doesNotMatch(ledgerService, /insertCashMovement\(/);

// 18 Dedicated section still shows maturities outside six months
assert.doesNotMatch(maturitiesRepo, /months\s*=\s*6|addMonths/);
assert.match(diagnostic, /outside_six_month_horizon|overdue/);

// Migration order docs: not only the two 20260727 files
assert.match(migrationOrder, /20260722_linked_purchase_payment_batches/);
assert.match(migrationOrder, /20260721_supplier_payment/);
assert.match(migrationOrder, /20260728_harden_credit_line_maturity_execution/);
assert.match(migrationOrder, /pg_notify|NOTIFY pgrst|reload schema/);
assert.match(migrationOrder, /ROLLBACK/);

// Available amount of inactive lines is not treated as usable credit in planning totals
assert.match(planning, /allCreditLines/);
assert.match(planning, /Solo lineas activas/);
assert.match(planning, /buildCreditLineRepaymentGroupEvents\(raw, allCreditLines\)/);

console.log("test-finance-credit-line-maturities: OK");
