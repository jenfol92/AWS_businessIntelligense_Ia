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
const baseRpc = readFileSync(
  new URL("../sql/migrations/finance_credit_lines_ledger_rpc.sql", import.meta.url),
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
const ledgerTypes = readFileSync(
  new URL("../modules/finance/types/creditLineLedger.types.ts", import.meta.url),
  "utf8",
);
const repayRoute = readFileSync(
  new URL("../app/api/finance/credit-lines/[id]/repay/route.ts", import.meta.url),
  "utf8",
);

assert.match(baseRpc, /finance_create_credit_line_drawdown/);
assert.match(baseRpc, /finance_create_credit_line_repayment/);

assert.match(phase1, /DROP FUNCTION IF EXISTS public\.finance_create_credit_line_drawdown/);
assert.match(phase1, /p_manual_due_date/);
assert.match(phase1, /p_bank_reference/);

assert.match(harden, /IDEMPOTENCY_PAYLOAD_MISMATCH/);
assert.match(harden, /pg_advisory_xact_lock/);
assert.match(harden, /finance_assert_finite_money/);
assert.match(harden, /ux_finance_credit_line_movements_idempotency_key/);
assert.match(harden, /CREDIT_LINE_DELETED|eliminada/);
assert.match(harden, /bank_reference/);

assert.match(ledgerTypes, /manualDueDate/);
assert.match(ledgerTypes, /bankReference/);
assert.match(ledgerTypes, /INVALID_CURRENCY/);
assert.match(ledgerTypes, /MISSING_REPAYMENT_GROUP/);
assert.match(ledgerTypes, /IDEMPOTENCY_PAYLOAD_MISMATCH/);
assert.match(ledgerTypes, /DIRECT_DML_FORBIDDEN/);

assert.match(ledgerRepo, /createCreditLineDrawdownRpc/);
assert.match(ledgerRepo, /createCreditLineRepaymentRpc/);
assert.match(ledgerRepo, /p_manual_due_date/);
assert.match(ledgerRepo, /p_bank_reference/);
assert.match(ledgerRepo, /DIRECT_DML_FORBIDDEN/);

assert.match(ledgerService, /createCreditLineDrawdown/);
assert.match(ledgerService, /createCreditLineRepayment/);
assert.match(ledgerService, /La cuenta de caja debe ser EUR/);
assert.match(ledgerService, /repaymentGroupId es obligatorio/);
assert.match(ledgerService, /DIRECT_DML_FORBIDDEN/);
assert.match(ledgerService, /isFinitePositiveMoney|isRealIsoDate/);

assert.match(repayRoute, /createCreditLineRepayment/);
assert.match(repayRoute, /INVALID_UUID/);
assert.match(repayRoute, /status: 422/);
assert.match(repayRoute, /sourceType:\s*"repayment_group"/);
assert.doesNotMatch(repayRoute, /sourceType:\s*"manual"/);

console.log("test-finance-credit-line-ledger: OK");
