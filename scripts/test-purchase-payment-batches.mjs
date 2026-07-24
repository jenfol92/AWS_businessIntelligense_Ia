import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../sql/migrations/20260722_linked_purchase_payment_batches.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../modules/finance/services/purchasePaymentBatchService.ts", import.meta.url),
  "utf8",
);
const modal = readFileSync(
  new URL("../modules/finance/components/LinkedPurchasePaymentModal.tsx", import.meta.url),
  "utf8",
);

const requiredSql = [
  "finance_purchase_payment_batches",
  "finance_purchase_payment_allocations",
  "create_and_apply_purchase_payment_batch",
  "get_purchase_payment_candidates",
  "get_purchase_payment_batch_detail",
  "FOR UPDATE",
  "AGENT_MISMATCH",
  "CURRENCY_MISMATCH",
  "OVERALLOCATION",
  "ALLOCATION_SUM_MISMATCH",
  "INSUFFICIENT_CASH",
  "INSUFFICIENT_CREDIT",
  "CREDIT_LINE_INACTIVE",
  "idempotent",
  "v_actual_eur - v_eur_assigned",
  "finance_create_credit_line_drawdown",
  "status = v_next_status",
  "'parcial'",
];
requiredSql.forEach((token) => assert.ok(migration.includes(token), `missing SQL contract: ${token}`));

assert.match(migration, /CHECK \(source_type IN \('cash_account', 'credit_line'\)\)/);
assert.doesNotMatch(migration, /source_type IN \([^)]*manual/);
assert.match(migration, /payee_type = 'agent'.*agent_id IS NOT NULL.*supplier_id IS NULL/s);
assert.match(migration, /status <> 'reversed'/);
assert.match(migration, /funded_total_eur = actual_amount_eur \+ bank_fee_eur \+ ff_fee_eur/);
assert.match(migration, /GRANT EXECUTE.*authenticated, service_role/s);
assert.match(service, /payload\.payeeType !== "agent"/);
assert.match(service, /sourceType === "manual"/);
assert.match(modal, /useState<PurchasePaymentSourceType \| "">\(""\)/);
assert.match(modal, /selected_payments/);
assert.match(modal, /free_amount/);
assert.match(modal, /crypto\.randomUUID\(\)/);
assert.match(modal, /Math\.abs\(totalApplied - principal\) > 0\.0001/);

console.log("OK purchase payment batches: schema, atomic guards, sources, partials, FX rounding, idempotency and UI contracts");
