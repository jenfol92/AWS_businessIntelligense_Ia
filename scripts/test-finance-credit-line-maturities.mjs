import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../sql/migrations/20260727_credit_line_maturities_phase1.sql", import.meta.url),
  "utf8",
);
const legacyMigration = readFileSync(
  new URL("../sql/migrations/20260727_credit_line_legacy_opening_balance_rpc.sql", import.meta.url),
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
const ledgerService = readFileSync(
  new URL("../modules/finance/services/creditLineLedgerService.ts", import.meta.url),
  "utf8",
);
const ledgerRepo = readFileSync(
  new URL("../modules/finance/repositories/creditLineLedgerRepository.ts", import.meta.url),
  "utf8",
);

// 1-3 Drawdown / due dates
assert.match(migration, /finance_create_credit_line_drawdown/);
assert.match(migration, /p_manual_due_date date DEFAULT NULL/);
assert.match(migration, /MANUAL_DUE_DATE_REQUIRED/);
assert.match(migration, /v_period_end := p_movement_date \+ v_line\.cycle_days/);
assert.match(migration, /due_date = v_due_date/);
assert.match(ledgerService, /manualDueDate/);
assert.match(ledgerRepo, /p_manual_due_date/);

// 4 Dedicated section not limited to 6 months
assert.match(maturitiesRepo, /finance_credit_line_repayment_groups/);
assert.doesNotMatch(maturitiesRepo, /months\s*=\s*6|addMonths/);
assert.match(maturitiesRoute, /\/api\/finance\/credit-lines\/maturities|buildCreditLineMaturities/);
assert.match(maturitiesService, /next_7|next_15|this_month|overdue/);

// 5 partially_paid → parcial
assert.match(maturitiesService, /partially_paid/);
assert.match(maturitiesService, /"parcial"/);
assert.match(planning, /groupStatus === "partially_paid"/);
assert.match(planning, /status: "parcial"|: "parcial"/);

// 6 overdue outside current month still listed
assert.match(maturitiesService, /dueDate < asOf/);
assert.match(diagnostic, /outside_six_month_horizon|overdue/);

// 7 informational 0€ not as maturity
assert.match(planningTypes, /credit_line_maturity/);
assert.match(planning, /type: "credit_line_maturity"/);
assert.match(planning, /isInformational: true/);
assert.match(planning, /type: "credit_line_release" as const/);
assert.match(
  planning,
  /function buildCreditLineRepaymentGroupEvents[\s\S]*?type: "credit_line_maturity"/,
);
assert.match(
  planning,
  /function buildCreditLineInformationalEvents[\s\S]*?type: "credit_line_release" as const/,
);

// 8-9 Modal starts empty, EUR only
assert.match(uiSection, /useState\(""\)/);
assert.match(uiSection, /currency\.trim\(\)\.toUpperCase\(\) === "EUR"/);
assert.doesNotMatch(uiSection, /cashAccounts\[0\]\?\.id/);
assert.match(uiSection, /Selecciona cuenta/);

// 10-15 repayment RPC contracts
assert.match(migration, /finance_create_credit_line_repayment/);
assert.match(migration, /partially_paid/);
assert.match(migration, /v_next_status := CASE WHEN v_next_remaining = 0 THEN 'paid' ELSE 'partially_paid' END/);
assert.match(migration, /used_amount = used_amount - p_amount/);
assert.match(migration, /available_amount = available_amount \+ p_amount/);
assert.match(migration, /balance = balance - p_amount/);
assert.match(migration, /idempotency_key/);
assert.match(migration, /INSUFFICIENT_CASH/);
assert.match(migration, /INVALID_CURRENCY: cash account must be EUR/);
assert.match(migration, /MISSING_REPAYMENT_GROUP/);
assert.match(migration, /GROUP_CLOSED/);
assert.match(migration, /CREDIT_LINE_INACTIVE/);
assert.match(migration, /FOR UPDATE/);
assert.match(migration, /SECURITY DEFINER/);
assert.match(migration, /SET search_path = public/);
assert.match(migration, /OWNER TO postgres/);
assert.match(migration, /auth\.uid\(\) IS NULL/);
assert.match(migration, /REVOKE EXECUTE[\s\S]*FROM PUBLIC, anon/);
assert.match(migration, /GRANT EXECUTE[\s\S]*TO authenticated, service_role/);
assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.finance_credit_line_movements FROM PUBLIC, anon, authenticated/);
assert.match(migration, /REVOKE UPDATE ON public\.finance_cash_accounts FROM PUBLIC, anon, authenticated/);

// 16 EUR rejected
assert.match(ledgerService, /INVALID_CURRENCY/);
assert.match(repayRoute, /bankReference/);

// 18-19 DML blocked / RPC authorized
assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.finance_credit_line_repayment_groups/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.finance_create_credit_line_repayment/);

// 20 no automatic legacy regularization
assert.doesNotMatch(planning, /finance_register_legacy_opening_balance/);
assert.doesNotMatch(maturitiesService, /finance_register_legacy_opening_balance/);
assert.match(legacyMigration, /legacy_opening_balance/);
assert.match(legacyMigration, /Does not change used_amount/);
assert.match(uiSection, /Saldo inicial pendiente de regularizar/);
assert.match(uiSection, /No se regulariza automaticamente/);

// UI section wired
assert.match(planningPage, /CreditLineMaturitiesSection/);
assert.match(uiSection, /Vencimientos de lineas/);
assert.match(uiSection, /Pagar saldo completo/);
assert.match(uiSection, /Registrar pago parcial/);

// Diagnostic classification
assert.match(diagnostic, /CONSISTENT/);
assert.match(diagnostic, /LEGACY_OPENING_BALANCE/);
assert.match(diagnostic, /ORPHAN_DRAWDOWN/);
assert.match(diagnostic, /GROUP_MISMATCH/);
assert.match(diagnostic, /MANUAL_DUE_DATE_REQUIRED/);

console.log("test-finance-credit-line-maturities: OK");
