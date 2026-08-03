import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return nextResolve("next/headers.js", context);
    if (specifier.startsWith("@/")) {
      return { shortCircuit: true, url: pathToFileURL(`${process.cwd()}/${specifier.slice(2)}.ts`).href };
    }
    if (context.parentURL?.includes("/ERP_BI_IA/") && !context.parentURL.includes("/node_modules/")
      && (specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
      return { shortCircuit: true, url: new URL(`${specifier}.ts`, context.parentURL).href };
    }
    return nextResolve(specifier, context);
  },
});

const {
  assertDateOnly,
  assertUuid,
  getUnlinkedObligationDetail,
  mapPayment,
  mapUnlinkedInstallmentBalance,
  mapUnlinkedObligationListItem,
  normalizeSearchQuery,
  normalizeUnlinkedObligationFilters,
  toNullableSafeNumber,
  toSafeNumber,
} = await import("./unlinkedObligationsService.ts");
const { findUnlinkedObligations } = await import("../repositories/unlinkedObligationsRepository.ts");

const obligationId = "11111111-1111-4111-8111-111111111111";
const installmentId = "22222222-2222-4222-8222-222222222222";

const listRow = {
  obligation_id: obligationId, template_id: null, occurrence_period: null, origin_type: "one_off",
  concept: "Alquiler", category: "rent", counterparty_name: "Arrendador", description: null,
  lifecycle_status: "active", amount_breakdown_mode: "total_only", planned_total_eur: "1000.00",
  paid_total_eur: "250.00", outstanding_total_eur: "750.00", financial_status: "partial",
  has_overdue_installment: true, next_pending_due_date: "2026-08-01", installment_count: 2,
  paid_installment_count: 0, partial_installment_count: 1, pending_installment_count: 1,
};

const totalOnly = mapUnlinkedInstallmentBalance({
  installment_id: installmentId, obligation_id: obligationId, plan_revision: 1, sequence_number: 1,
  due_date: "2026-08-01", installment_status: "active", amount_breakdown_mode: "total_only",
  planned_principal_eur: null, planned_interest_eur: null, planned_other_fees_eur: null, planned_total_eur: "1000",
  allocated_principal_eur: null, allocated_interest_eur: null, allocated_other_fees_eur: null,
  allocated_total_eur: "250", outstanding_total_eur: "750", financial_status: "partial", temporal_condition: "overdue",
});
assert.equal(totalOnly.plannedPrincipalEur, null);
assert.equal(totalOnly.allocatedInterestEur, null);

const detailed = mapUnlinkedInstallmentBalance({
  installment_id: installmentId, obligation_id: obligationId, plan_revision: "2", sequence_number: "1",
  due_date: "2026-09-01", installment_status: "superseded", amount_breakdown_mode: "detailed",
  planned_principal_eur: "80.00", planned_interest_eur: 15, planned_other_fees_eur: "5", planned_total_eur: "100",
  allocated_principal_eur: "0", allocated_interest_eur: 0, allocated_other_fees_eur: "0",
  allocated_total_eur: "0", outstanding_total_eur: 0, financial_status: "superseded", temporal_condition: "current",
});
assert.equal(detailed.plannedPrincipalEur + detailed.plannedInterestEur + detailed.plannedOtherFeesEur, detailed.plannedTotalEur);
assert.equal(detailed.status, "superseded");
assert.equal(detailed.planRevision, 2);

const partialOverdue = mapUnlinkedObligationListItem(listRow);
assert.equal(partialOverdue.financialStatus, "partial");
assert.equal(partialOverdue.hasOverdueInstallment, true);

assert.equal(toSafeNumber("12.34"), 12.34);
assert.equal(toSafeNumber(0), 0);
assert.equal(toNullableSafeNumber(null), null);
assert.throws(() => toSafeNumber("not-a-number"), /INVALID_NUMERIC/);
assert.throws(() => toSafeNumber("   "), /INVALID_NUMERIC/);
assert.throws(() => toSafeNumber("\t"), /INVALID_NUMERIC/);
assert.equal(assertUuid(obligationId), obligationId);
assert.throws(() => assertUuid("bad"), /INVALID_UUID/);
assert.equal(assertDateOnly("2028-02-29"), "2028-02-29");
assert.throws(() => assertDateOnly("2027-02-29"), /INVALID_DATE/);
assert.equal(normalizeSearchQuery("   "), undefined);
assert.equal(normalizeSearchQuery("  seguridad   social "), "seguridad social");
assert.equal(normalizeUnlinkedObligationFilters({ overdue: true }).overdue, true);
assert.equal(normalizeUnlinkedObligationFilters({ overdue: false }).overdue, false);

const cashAccountId = "33333333-3333-4333-8333-333333333333";
const creditLineId = "44444444-4444-4444-8444-444444444444";
const cashMovementId = "55555555-5555-4555-8555-555555555555";
const creditMovementId = "66666666-6666-4666-8666-666666666666";
const repaymentGroupId = "77777777-7777-4777-8777-777777777777";
const paymentRow = {
  id: "88888888-8888-4888-8888-888888888888", obligation_id: obligationId,
  paid_at: "2026-08-03T10:00:00.000Z", amount_breakdown_mode: "total_only",
  actual_principal_eur: null, actual_interest_eur: null, actual_other_fees_eur: null,
  actual_total_eur: "100", bank_fee_eur: "5", funded_total_eur: "105",
  bank_reference: null, notes: null, status: "posted", created_at: "2026-08-03T10:00:00.000Z",
};
const cashPayment = mapPayment({
  ...paymentRow, source_type: "cash_account", cash_account_id: cashAccountId,
  credit_line_id: null, cash_movement_id: cashMovementId,
  credit_line_movement_id: null, repayment_group_id: null,
});
assert.equal(cashPayment.cashAccountId, cashAccountId);
assert.equal(cashPayment.creditLineId, null);
assert.equal(cashPayment.cashMovementId, cashMovementId);

const creditPayment = mapPayment({
  ...paymentRow, source_type: "credit_line", cash_account_id: null,
  credit_line_id: creditLineId, cash_movement_id: null,
  credit_line_movement_id: creditMovementId, repayment_group_id: repaymentGroupId,
});
assert.equal(creditPayment.creditLineId, creditLineId);
assert.equal(creditPayment.repaymentGroupId, repaymentGroupId);

assert.throws(() => mapPayment({
  ...paymentRow, source_type: "cash_account", cash_account_id: cashAccountId,
  credit_line_id: creditLineId, cash_movement_id: cashMovementId,
  credit_line_movement_id: null, repayment_group_id: null,
}), /INVALID_ROW/);

function filterClient(calls) {
  const builder = {
    select() { return this; },
    or(value) { calls.push(["or", value]); return this; },
    eq(field, value) { calls.push(["eq", field, value]); return this; },
    gte(field, value) { calls.push(["gte", field, value]); return this; },
    lte(field, value) { calls.push(["lte", field, value]); return this; },
    in(field, value) { calls.push(["in", field, value]); return this; },
    order() { return Promise.resolve({ data: [], error: null }); },
  };
  return { from(table) { calls.push(["from", table]); return builder; } };
}
const trueCalls = [];
await findUnlinkedObligations({ q: "   ", overdue: true }, filterClient(trueCalls));
assert.deepEqual(trueCalls, [
  ["from", "finance_unlinked_obligation_balances"],
  ["eq", "has_overdue_installment", true],
]);
const falseCalls = [];
await findUnlinkedObligations({ overdue: false }, filterClient(falseCalls));
assert.deepEqual(falseCalls, [
  ["from", "finance_unlinked_obligation_balances"],
  ["eq", "has_overdue_installment", false],
]);

const notFoundClient = {
  from() {
    return {
      select() { return this; }, eq() { return this; },
      maybeSingle() { return Promise.resolve({ data: null, error: null }); },
    };
  },
};
await assert.rejects(
  () => getUnlinkedObligationDetail(obligationId, notFoundClient),
  /NOT_FOUND/,
);

console.log("unlinked obligations read service tests: ok");
