import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url), "utf8");
const schema = read("20260803_01_unlinked_obligations_schema.sql");
const rls = read("20260803_02_unlinked_obligations_rls.sql");
const planning = read("20260803_03_unlinked_obligation_planning_rpcs.sql");
const recurrence = read("20260803_04_unlinked_obligation_recurrence_rpcs.sql");
const views = read("20260803_05_unlinked_obligation_read_models.sql");
const allPhase = [schema, rls, planning, recurrence, views].join("\n");

const tables = [
  "finance_unlinked_obligation_templates", "finance_unlinked_obligations",
  "finance_unlinked_obligation_installments", "finance_unlinked_obligation_payments",
  "finance_unlinked_obligation_payment_allocations",
];
for (const table of tables) {
  assert.match(schema, new RegExp(`CREATE TABLE public\\.${table}`));
  assert.match(rls, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  assert.match(rls, new RegExp(`REVOKE ALL ON public\\.${table} FROM PUBLIC, anon, authenticated`));
}

// total_only means unknown components are NULL; detailed means known components, including known zero.
assert.equal((schema.match(/amount_breakdown_mode text NOT NULL DEFAULT 'total_only'/g) ?? []).length, 5);
assert.equal((schema.match(/amount_breakdown_mode IN \('total_only', 'detailed'\)/g) ?? []).length, 5);
assert.match(schema, /amount_breakdown_mode = 'total_only'[\s\S]*planned_principal_eur IS NULL[\s\S]*planned_interest_eur IS NULL[\s\S]*planned_other_fees_eur IS NULL/);
assert.match(schema, /amount_breakdown_mode = 'detailed'[\s\S]*planned_principal_eur >= 0[\s\S]*planned_total_eur = planned_principal_eur \+ planned_interest_eur \+ planned_other_fees_eur/);
assert.match(schema, /actual_total_eur numeric\(14, 2\) NOT NULL/);
assert.match(schema, /funded_total_eur = actual_total_eur \+ bank_fee_eur/);
assert.doesNotMatch(schema, /allocatable_amount_eur/);
assert.match(schema, /amount_breakdown_mode = 'total_only'[\s\S]*actual_principal_eur IS NULL/);
assert.match(schema, /amount_breakdown_mode = 'total_only'[\s\S]*allocated_principal_eur IS NULL/);

// Financial state is derived; only lifecycle is stored.
const obligationBlock = schema.match(/CREATE TABLE public\.finance_unlinked_obligations \(([\s\S]*?)\n\);/)?.[1] ?? "";
assert.match(obligationBlock, /lifecycle_status text NOT NULL DEFAULT 'active'/);
assert.doesNotMatch(obligationBlock, /financial_status/);
assert.doesNotMatch(obligationBlock, /paid_amount_eur|outstanding_amount_eur|overdue/);
assert.match(views, /END AS financial_status/);
assert.match(views, /o\.lifecycle_status = 'cancelled'/);
assert.match(views, /i\.due_date < current_date THEN 'overdue'/);
assert.match(views, /coalesce\(a\.allocated_total_eur, 0\)/);
assert.match(views, /WHERE p\.status = 'posted'/);

// Every posted payment is fully allocated, with matching modes and component limits.
for (const code of [
  "PAYMENT_REQUIRES_ALLOCATION", "PAYMENT_ALLOCATION_TOTAL_MISMATCH",
  "PAYMENT_ALLOCATION_PRINCIPAL_MISMATCH", "PAYMENT_ALLOCATION_INTEREST_MISMATCH",
  "PAYMENT_ALLOCATION_FEES_MISMATCH", "PAYMENT_ALLOCATION_MODE_MISMATCH",
  "INSTALLMENT_ALLOCATION_MODE_MISMATCH", "INSTALLMENT_PRINCIPAL_OVERPAYMENT",
  "INSTALLMENT_INTEREST_OVERPAYMENT", "INSTALLMENT_FEES_OVERPAYMENT",
  "INSTALLMENT_TOTAL_OVERPAYMENT",
]) assert.ok(schema.includes(code), `${code} must be enforced`);
assert.match(schema, /v_total<>v_payment\.actual_total_eur/);
assert.match(schema, /v_principal<>v_payment\.actual_principal_eur/);
assert.match(schema, /AFTER INSERT OR UPDATE OR DELETE ON public\.finance_unlinked_obligation_payments[\s\S]*DEFERRABLE INITIALLY DEFERRED/);
assert.match(schema, /AFTER INSERT OR UPDATE OR DELETE ON public\.finance_unlinked_obligation_payment_allocations[\s\S]*DEFERRABLE INITIALLY DEFERRED/);

// Replanning preserves history and permits sequence reuse in a new revision.
assert.match(schema, /plan_revision integer NOT NULL DEFAULT 1/);
assert.match(schema, /UNIQUE \(obligation_id, plan_revision, sequence_number\)/);
assert.match(schema, /superseded_at timestamptz NULL/);
assert.match(schema, /superseded_by uuid NULL REFERENCES auth\.users/);
assert.match(planning, /status='superseded',superseded_at=now\(\),superseded_by=v_user_id/);
assert.match(planning, /max\(plan_revision\),0\)\+1/);
assert.doesNotMatch(planning, /DELETE FROM public\.finance_unlinked_obligation_installments/i);
for (const code of ["REPLAN_MODE_REQUIRED", "REPLAN_TOTAL_REQUIRED", "REPLAN_COMPONENTS_REQUIRED", "REPLAN_INSTALLMENTS_REQUIRED"])
  assert.ok(planning.includes(code), `${code} must be enforced`);
const replanBlock = planning.match(/CREATE OR REPLACE FUNCTION public\.finance_replace_unpaid_installment_plan[\s\S]*?\n\$\$;/)?.[0] ?? "";
assert.doesNotMatch(replanBlock, /coalesce\([^\n]*'total_only'/i);
assert.match(schema, /every active obligation must have at least one active installment/);
assert.match(schema, /count\(DISTINCT plan_revision\)/);

// Manual and automatic plans reconcile every known component independently.
for (const code of [
  "INSTALLMENT_PRINCIPAL_SUM_MISMATCH", "INSTALLMENT_INTEREST_SUM_MISMATCH",
  "INSTALLMENT_FEES_SUM_MISMATCH", "INSTALLMENT_TOTAL_SUM_MISMATCH",
]) {
  assert.ok(planning.includes(code));
  assert.ok(schema.includes(code));
}
assert.match(planning, /v_principal_cents-v_base_principal\*\(v_count-1\)/);
assert.match(planning, /v_interest_cents-v_base_interest\*\(v_count-1\)/);
assert.match(planning, /v_fees_cents-v_base_fees\*\(v_count-1\)/);
assert.match(planning, /v_total_cents-v_base_total\*\(v_count-1\)/);
assert.match(planning, /TOTAL_ONLY_COMPONENTS_FORBIDDEN/);
assert.doesNotMatch(planning, /v_current_cents::numeric \/ 100, 0, 0/);

// Recurrence retains civil anchor and locks frequency after the first occurrence.
assert.match(recurrence, /pg_advisory_xact_lock/);
assert.match(recurrence, /ON CONFLICT \(template_id,occurrence_period\) WHERE template_id IS NOT NULL DO NOTHING/);
assert.match(recurrence, /IMMUTABLE_TEMPLATE_FREQUENCY/);
assert.match(recurrence, /v_has_occurrences AND v_interval<>v_template\.frequency_interval/);
assert.match(recurrence, /END_DATE_BEFORE_LATEST_OCCURRENCE/);
assert.match(recurrence, /least\(v_template\.anchor_day,v_last_day\)/);
assert.match(recurrence, /v_template\.amount_breakdown_mode/);
assert.match(recurrence, /v_principal:=CASE WHEN p_payload\?'planned_principal_eur' THEN round/);
assert.match(recurrence, /v_total:=CASE WHEN p_payload\?'planned_total_eur' THEN round/);

// No operative financing is introduced in Phase 1.
assert.doesNotMatch(planning + recurrence, /finance_cash_movements|finance_credit_line_movements|finance_create_credit_line_drawdown/);
assert.doesNotMatch(allPhase, /source_type[^\n]*manual/);
assert.match(schema, /source_type IN \('cash_account', 'credit_line'\)/);

function occurrence(year, monthIndex, anchorDay) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, monthIndex, Math.min(anchorDay, last))).toISOString().slice(0, 10);
}
assert.deepEqual([0,1,2,3].map((m) => occurrence(2027,m,31)), ["2027-01-31","2027-02-28","2027-03-31","2027-04-30"]);
assert.equal(occurrence(2028,1,31), "2028-02-29");
assert.equal(occurrence(2027,1,29), "2027-02-28");
assert.deepEqual([0,3,6,9].map((m)=>occurrence(2027,m,31)), ["2027-01-31","2027-04-30","2027-07-31","2027-10-31"]);

console.log("unlinked obligations phase 1 corrected structural tests: ok");
