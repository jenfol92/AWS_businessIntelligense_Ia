import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizePurchasePaymentBatchPayload,
} from "../modules/finance/services/purchasePaymentBatchService.ts";
import {
  togglePurchasePaymentCandidate,
} from "../modules/finance/utils/purchasePaymentSelection.ts";
import {
  partitionFinanceEventsByDate,
} from "../modules/finance/utils/partitionFinanceEventsByDate.ts";

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
const planningTypes = readFileSync(
  new URL("../modules/finance/types/planning.types.ts", import.meta.url),
  "utf8",
);
const executionTypes = readFileSync(
  new URL("../modules/finance/types/supplierPaymentExecution.types.ts", import.meta.url),
  "utf8",
);
const executionService = readFileSync(
  new URL("../modules/finance/services/supplierPaymentExecutionService.ts", import.meta.url),
  "utf8",
);
const individualRoute = readFileSync(
  new URL("../app/api/finance/supplier-payments/[id]/mark-paid/route.ts", import.meta.url),
  "utf8",
);
const integrityPreflight = readFileSync(
  new URL("../sql/diagnostics/linked_purchase_payment_integrity_preflight.sql", import.meta.url),
  "utf8",
);
const transactionalDiagnostic = readFileSync(
  new URL("../sql/diagnostics/linked_purchase_payment_batches_transactional_test.sql", import.meta.url),
  "utf8",
);
const supplierPaymentsRepository = readFileSync(
  new URL("../modules/finance/repositories/financeSupplierPaymentsRepository.ts", import.meta.url),
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
  "PARTIAL_PAYMENT_PLAN_MISMATCH",
  "pending_before_original",
  "pending_after_original",
  "resulting_status",
  "status = v_next_status",
  "'parcial'",
  "finance_is_finite_numeric",
  "INVALID_FEE",
  "INVALID_ALLOCATION_AMOUNT",
  "LEGACY_MANUAL_PAYMENT",
  "PREFLIGHT_CONFLICTING_STATUS_CHECK",
  "REVOKE INSERT, UPDATE, DELETE ON public.finance_supplier_payments FROM PUBLIC, anon, authenticated",
  "void_pending_supplier_payment_plan",
];
requiredSql.forEach((token) => assert.ok(migration.includes(token), `missing SQL contract: ${token}`));

assert.match(migration, /CHECK \(source_type IN \('cash_account', 'credit_line'\)\)/);
assert.doesNotMatch(migration, /source_type IN \([^)]*manual/);
assert.match(migration, /payee_type = 'agent'.*agent_id IS NOT NULL.*supplier_id IS NULL/s);
assert.match(migration, /status <> 'reversed'/);
assert.match(migration, /funded_total_eur = actual_amount_eur \+ bank_fee_eur \+ ff_fee_eur/);
assert.match(migration, /GRANT EXECUTE.*authenticated, service_role/s);
assert.match(migration, /coalesce\(sp\.payment_source_type, ''\) <> 'manual'/);
assert.match(migration, /v_payment\.payment_source_type = 'manual'/);
assert.match(supplierPaymentsRepository, /\.rpc\("void_pending_supplier_payment_plan"/);
assert.doesNotMatch(
  supplierPaymentsRepository,
  /\.from\("finance_supplier_payments"\)[\s\S]{0,160}\.delete\(/,
);
for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
  assert.match(integrityPreflight, new RegExp(`has_table_privilege\\('authenticated',[\\s\\S]*?'${privilege}'\\)`));
}
for (const rpc of [
  "sync_supplier_payment_plan",
  "mark_and_finance_supplier_payment",
  "create_and_apply_purchase_payment_batch",
  "get_purchase_payment_candidates",
  "get_purchase_payment_batch_detail",
]) {
  assert.match(integrityPreflight, new RegExp(`'${rpc}'`));
}
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
assert.match(planning, /partitionFinanceEventsByDate\(events\)/);
assert.match(planning, /if \(event\.status === "pagado"\) continue;/);
assert.match(planningTypes, /supplier_payment_settlement/);
assert.match(planning, /type: "supplier_payment_settlement"/);
assert.match(planning, /date: dueDate/);
assert.match(planning, /settlementPaidAt \? settlementPaidAt\.slice\(0, 10\) : null/);
assert.match(planning, /date: settlementDate/);
assert.match(planning, /month: dateToMonth\(settlementDate\)/);
assert.match(planning, /paidAt: settlementPaidAt/);
assert.match(planning, /const horizonEvents = months\.flatMap/);
assert.match(planning, /paidPayments: horizonEvents/);
assert.match(planning, /if \(pendingOriginal > 0\.0001\) events\.push/);
assert.match(planning, /supplier_payment_settlement"\) return event\.allocatedAmountEur/);
assert.match(
  planning,
  /if \(event\.status === "pagado"\) continue;[\s\S]*?event\.recommendedSource === "cash"/,
);
assert.match(planningTypes, /pendingDateEvents: FinancePlanningEvent\[\]/);
assert.match(migration, /a\.resulting_status/);
assert.doesNotMatch(migration, /'resulting_status', sp\.status/);
const partialSyncBlock = migration.match(
  /IF v_payment\.status = 'parcial' THEN([\s\S]*?)RETURN v_payment;\s+END IF;/,
)?.[1] ?? "";
assert.match(partialSyncBlock, /PARTIAL_PAYMENT_PLAN_MISMATCH/);
assert.match(partialSyncBlock, /due_date = p_due_date/);
assert.doesNotMatch(partialSyncBlock, /amount_original = p_amount_original/);
assert.doesNotMatch(partialSyncBlock, /status = p_status/);
assert.match(migration, /coalesce\(auth\.role\(\)/);
assert.match(migration, /NOTIFY pgrst, 'reload schema'/);
assert.match(individualRoute, /payment: result\.payment, financing: result/);
for (const nanCase of [
  "test-nan-amount",
  "test-nan-fx",
  "test-nan-fee",
  "test-nan-allocation",
]) {
  assert.match(transactionalDiagnostic, new RegExp(nanCase));
}
assert.match(transactionalDiagnostic, /test-real-multi-order/);
assert.match(transactionalDiagnostic, /jsonb_array_length\(v_result->'allocations'\) <> 2/);
assert.match(transactionalDiagnostic, /TEST Factory A/);
assert.match(transactionalDiagnostic, /TEST Factory B/);
assert.match(transactionalDiagnostic, /test-multi-agent-rollback/);
assert.doesNotMatch(transactionalDiagnostic, /AGENT_MISMATCH:%'[\s\S]{0,80}OBLIGATION_ALREADY_PAID/);
assert.match(transactionalDiagnostic, /authenticated updated status directly/);
assert.match(transactionalDiagnostic, /IDEMPOTENCY_PAYLOAD_MISMATCH/);
for (const malformedCase of [
  "test-text-amount",
  "test-text-fx",
  "test-text-fee",
  "test-text-allocation",
  "test-entry-mode",
  "test-missing-currency",
]) {
  assert.match(transactionalDiagnostic, new RegExp(malformedCase));
}
assert.match(transactionalDiagnostic, /0\.900001/);
assert.match(transactionalDiagnostic, /900\.01/);
assert.match(transactionalDiagnostic, /TEST-MULTI-CHANGED/);
assert.match(transactionalDiagnostic, /2026-07-25T18:30:00Z/);
assert.match(migration, /payload_fingerprint/);
assert.match(integrityPreflight, /payload_fingerprint/);
assert.match(migration, /INVALID_PLAN_FX/);
assert.match(migration, /INVALID_PLAN_EUR_AMOUNT/);
assert.match(migration, /IDEMPOTENCY_PAYLOAD_MISMATCH/);
for (const fingerprintField of [
  "payee_type",
  "entry_mode",
  "actual_fx_rate",
  "actual_amount_eur",
  "bank_fee_eur",
  "ff_fee_eur",
  "funded_total_eur",
  "bank_reference",
  "notes",
]) {
  assert.match(migration, new RegExp(`'${fingerprintField}'`));
}
for (const field of [
  "batch_id",
  "source_type",
  "cash_account_id",
  "credit_line_id",
  "funded_total_eur",
]) {
  assert.match(executionTypes, new RegExp(`${field}:`), `missing individual response field ${field}`);
}
for (const code of [
  "OBLIGATION_ALREADY_PAID",
  "OVERALLOCATION",
  "ORDER_NOT_CONFIRMED",
  "AGENT_MISMATCH",
  "CURRENCY_MISMATCH",
  "INSUFFICIENT_CASH",
  "INSUFFICIENT_CREDIT",
  "UNAUTHORIZED",
  "INVALID_PAYEE_TYPE",
  "INVALID_IDEMPOTENCY_KEY",
  "INVALID_AMOUNT",
  "INVALID_ACTUAL_VALUES",
  "INVALID_FEE",
  "INVALID_ALLOCATIONS",
  "INVALID_ALLOCATION_AMOUNT",
  "ALLOCATION_SUM_MISMATCH",
  "OBLIGATION_NOT_FOUND",
  "ORDER_NOT_FOUND",
  "CASH_ACCOUNT_NOT_FOUND",
  "CREDIT_LINE_NOT_FOUND",
  "INVALID_SOURCE",
  "LEGACY_MANUAL_PAYMENT",
  "PARTIAL_PAYMENT_PLAN_MISMATCH",
  "INVALID_UUID",
  "INVALID_PLAN_CURRENCY",
  "IDEMPOTENCY_PAYLOAD_MISMATCH",
]) {
  assert.match(executionService, new RegExp(`${code}:`), `missing error mapping ${code}`);
}

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
  agentId: "11111111-1111-4111-8111-111111111111",
  entryMode: "selected_payments",
  amountOriginal: 100,
  originalCurrency: "EUR",
  paidAt: "2026-07-24",
  sourceType: "cash_account",
  cashAccountId: "22222222-2222-4222-8222-222222222222",
  idempotencyKey: "eur-without-explicit-fx",
  allocations: [{ supplierPaymentId: "33333333-3333-4333-8333-333333333333", amountOriginal: 100 }],
});
assert.equal(eurPayload.actualFxRate, null);
assert.equal(eurPayload.actualAmountEur, null);
assert.throws(
  () => normalizePurchasePaymentBatchPayload({ ...eurPayload, sourceType: "manual" }),
  /fuente manual no está permitida/i,
);

const settlementPaidAt = "2026-07-24T18:30:00Z";
const settlementDate = settlementPaidAt.slice(0, 10);
assert.equal(settlementDate, "2026-07-24");
assert.equal(settlementPaidAt, "2026-07-24T18:30:00Z");
assert.equal(settlementDate.slice(0, 7), "2026-07");
assert.ok(settlementDate <= "2026-07-24", "fechaHasta inclusiva debe conservar el settlement");
assert.equal(Number.isNaN(new Date(`${settlementDate}T00:00:00Z`).getTime()), false);
assert.throws(
  () => normalizePurchasePaymentBatchPayload({ ...eurPayload, paidAt: "2026-07-24", agentId: "not-a-uuid" }),
  /UUID valido/i,
);
assert.throws(
  () => normalizePurchasePaymentBatchPayload({ ...eurPayload, paidAt: "2026-02-31" }),
  /fecha valida/i,
);
assert.throws(
  () => normalizePurchasePaymentBatchPayload({ ...eurPayload, paidAt: "2026-07-24", originalCurrency: "JPY" }),
  /USD, EUR, GBP o CNY/i,
);

const eventBase = {
  id: "event",
  type: "supplier_deposit",
  title: "Deposit",
  date: null,
  month: null,
  isPendingDate: true,
  status: "pendiente",
};
const partitioned = partitionFinanceEventsByDate([
  { ...eventBase, id: "deposit-undated" },
  { ...eventBase, id: "balance-undated", type: "supplier_balance" },
  {
    ...eventBase,
    id: "deposit-dated",
    date: "2026-08-12",
    month: "2026-08",
    isPendingDate: false,
  },
]);
assert.deepEqual(
  partitioned.pendingDateEvents.map((event) => event.id),
  ["deposit-undated", "balance-undated"],
);
assert.deepEqual(partitioned.datedEvents.map((event) => event.id), ["deposit-dated"]);

console.log("OK purchase payment batches: behavior, persistent selection, EUR, authorization, partials, idempotency and detail contracts");
