import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FINANCE_MONEY_MAX_AFTER_ROUND,
  isFinitePositiveMoney,
} from "../modules/finance/utils/financeInputValidation.ts";

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

assert.match(phase1, /p_manual_due_date/);
assert.match(harden, /IDEMPOTENCY_PAYLOAD_MISMATCH/);
assert.match(runtime, /idempotency key belongs to a different movement_type/);
assert.match(runtime, /9999999999\.9999/);
assert.match(runtime, /GRANT EXECUTE ON FUNCTION public\.finance_create_credit_line_drawdown[\s\S]*TO service_role/);
assert.match(runtime, /source_type must be supplier_payment or purchase_payment_batch/);
assert.match(runtime, /v_line_status IN \('eliminada', 'deleted'\)/);

assert.match(ledgerTypes, /manualDueDate/);
assert.match(ledgerTypes, /IDEMPOTENCY_PAYLOAD_MISMATCH/);
assert.match(ledgerTypes, /DIRECT_DML_FORBIDDEN/);

assert.match(ledgerRepo, /createCreditLineDrawdownRpc/);
assert.match(ledgerRepo, /DIRECT_DML_FORBIDDEN/);

assert.match(ledgerService, /createCreditLineRepayment/);
assert.match(ledgerService, /DIRECT_DML_FORBIDDEN/);
assert.match(ledgerService, /isFinitePositiveMoney|isRealIsoDate/);

assert.match(repayRoute, /INVALID_UUID/);
assert.match(repayRoute, /IDEMPOTENCY_PAYLOAD_MISMATCH/);
assert.match(repayRoute, /sourceType:\s*"repayment_group"/);

assert.equal(isFinitePositiveMoney(FINANCE_MONEY_MAX_AFTER_ROUND), true);
assert.equal(isFinitePositiveMoney(Number.NaN), false);
assert.equal(isFinitePositiveMoney(Number.POSITIVE_INFINITY), false);

console.log("test-finance-credit-line-ledger: OK");
