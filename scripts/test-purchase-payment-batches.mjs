import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizePurchasePaymentBatchPayload,
} from "../modules/finance/services/purchasePaymentBatchService.ts";
import {
  togglePurchasePaymentCandidate,
} from "../modules/finance/utils/purchasePaymentSelection.ts";

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
const detailModal = readFileSync(
  new URL("../modules/finance/components/PurchasePaymentBatchDetailModal.tsx", import.meta.url),
  "utf8",
);
const planning = readFileSync(
  new URL("../modules/finance/services/buildFinancialPlanning.ts", import.meta.url),
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
  "SECURITY DEFINER",
  "auth.uid() IS NULL",
  "pg_advisory_xact_lock",
  "unique_violation",
  "ORDER_NOT_CONFIRMED",
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
assert.match(modal, /useState\(\(\) => crypto\.randomUUID\(\)\)/);
assert.match(modal, /Math\.abs\(totalApplied - principal\) > 0\.0001/);
assert.match(detailModal, /Detalle del pago vinculado/);
assert.match(detailModal, /allocated_amount_original/);
assert.match(planning, /status === "parcial"/);
assert.match(planning, /mixedSources/);
assert.match(planning, /weightedFxRate/);

const baseCandidate = {
  supplierPaymentId: "payment-a",
  orderId: "order-a",
  orderNumber: "A",
  agentOrderNumber: null,
  agentId: "agent-a",
  agentName: "Agent A",
  supplierId: "supplier-a",
  supplierName: "Factory A",
  paymentType: "DEPOSITO_30",
  amountOriginal: 100,
  originalCurrency: "USD",
  allocatedAmountOriginal: 0,
  pendingAmountOriginal: 100,
  dueDate: null,
  status: "pendiente",
};
let persistentSelection = togglePurchasePaymentCandidate(new Map(), baseCandidate);
persistentSelection = togglePurchasePaymentCandidate(persistentSelection, {
  ...baseCandidate,
  supplierPaymentId: "payment-b",
  orderId: "order-b",
  orderNumber: "B",
  supplierId: "supplier-b",
});
assert.equal(persistentSelection.size, 2, "successive searches must preserve selected obligations");
persistentSelection = togglePurchasePaymentCandidate(persistentSelection, {
  ...baseCandidate,
  supplierPaymentId: "payment-other-agent",
  agentId: "agent-b",
});
assert.equal(persistentSelection.size, 2, "agent lock must apply to persistent selection");

const eurPayload = normalizePurchasePaymentBatchPayload({
  payeeType: "agent",
  agentId: "agent-a",
  entryMode: "selected_payments",
  amountOriginal: 100,
  originalCurrency: "EUR",
  paidAt: "2026-07-24",
  sourceType: "cash_account",
  cashAccountId: "cash-a",
  idempotencyKey: "eur-without-explicit-fx",
  allocations: [{ supplierPaymentId: "payment-a", amountOriginal: 100 }],
});
assert.equal(eurPayload.actualFxRate, null);
assert.equal(eurPayload.actualAmountEur, null);
assert.throws(
  () => normalizePurchasePaymentBatchPayload({ ...eurPayload, sourceType: "manual" }),
  /fuente manual no está permitida/i,
);

console.log("OK purchase payment batches: behavior, persistent selection, EUR, authorization, partials, idempotency and detail contracts");
