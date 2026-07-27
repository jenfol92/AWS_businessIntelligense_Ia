import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../sql/migrations/20260727_credit_line_maturities_phase1.sql", import.meta.url),
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

assert.match(migration, /DROP FUNCTION IF EXISTS public\.finance_create_credit_line_drawdown/);
assert.match(migration, /DROP FUNCTION IF EXISTS public\.finance_create_credit_line_repayment/);
assert.match(migration, /p_manual_due_date/);
assert.match(migration, /p_bank_reference/);
assert.match(migration, /'credit_repayment'/);
assert.match(migration, /'out'/);
assert.match(migration, /repayment_group_id is required/i);

assert.match(ledgerTypes, /manualDueDate/);
assert.match(ledgerTypes, /bankReference/);
assert.match(ledgerTypes, /INVALID_CURRENCY/);
assert.match(ledgerTypes, /MISSING_REPAYMENT_GROUP/);

assert.match(ledgerRepo, /createCreditLineDrawdownRpc/);
assert.match(ledgerRepo, /createCreditLineRepaymentRpc/);
assert.match(ledgerRepo, /p_manual_due_date/);
assert.match(ledgerRepo, /p_bank_reference/);

assert.match(ledgerService, /createCreditLineDrawdown/);
assert.match(ledgerService, /createCreditLineRepayment/);
assert.match(ledgerService, /La cuenta de caja debe ser EUR/);
assert.match(ledgerService, /repaymentGroupId es obligatorio/);

assert.match(repayRoute, /createCreditLineRepayment/);
assert.match(repayRoute, /repaymentGroupId es obligatorio/);
assert.match(repayRoute, /cashAccountId es obligatorio/);
assert.doesNotMatch(repayRoute, /sourceType:\s*"manual"/);
assert.match(repayRoute, /sourceType:\s*"repayment_group"/);

console.log("test-finance-credit-line-ledger: OK");
