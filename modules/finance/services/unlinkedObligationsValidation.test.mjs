import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
const repositoryUrl = `${pathToFileURL(process.cwd()).href}/`;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  if (context.parentURL?.startsWith(repositoryUrl) && !context.parentURL.includes("/node_modules/") && (specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) return { shortCircuit: true, url: new URL(`${specifier}.ts`, context.parentURL).href };
  return nextResolve(specifier, context);
} });
const {
  validateCancellation,
  validateCreateObligation,
  validateCreateTemplate,
  validateDate,
  validateMetadataUpdate,
  validateObligationListQuery,
  validateReplacementPlan,
  validateTemplateListQuery,
  validateTreasuryRange,
  validateUpdateTemplate,
} = await import("./unlinkedObligationsValidation.ts");

const base = { concept: "Rent", category: "rent", planned_total_eur: 100, installment_dates: ["2026-08-10"] };
const hasCode = (code) => (error) => error?.code === code;

test("valid total_only and detailed payloads", () => {
  assert.equal(validateCreateObligation(base).planned_total_eur, 100);
  const detailed = validateCreateObligation({ ...base, amount_breakdown_mode: "detailed", planned_principal_eur: 80, planned_interest_eur: 15, planned_other_fees_eur: 5 });
  assert.equal(detailed.amount_breakdown_mode, "detailed");
});

test("money uses normalized cents without binary floating point false positives", () => {
  for (const amount of [0.29, 0.07, 19.99, 10.20, 123.45]) {
    assert.equal(validateCreateObligation({ ...base, planned_total_eur: amount }).planned_total_eur, amount);
  }
  for (const amount of [0.291, 1.999, Number.NaN, Number.POSITIVE_INFINITY, "19.99"]) {
    assert.throws(() => validateCreateObligation({ ...base, planned_total_eur: amount }), hasCode("INVALID_AMOUNT"));
  }
});

test("all financial components are normalized before reaching an RPC", () => {
  const obligation = validateCreateObligation({
    concept: "Loan", category: "loan", amount_breakdown_mode: "detailed",
    planned_principal_eur: 0.30000000000000004, planned_interest_eur: 0.2, planned_other_fees_eur: 0.5, planned_total_eur: 1,
    installments: [{
      due_date: "2026-08-10", planned_principal_eur: 0.30000000000000004,
      planned_interest_eur: 0.2, planned_other_fees_eur: 0.5, planned_total_eur: 1,
    }],
  });
  assert.equal(obligation.planned_principal_eur, 0.3);
  assert.equal(obligation.installments?.[0].planned_principal_eur, 0.3);
  const template = validateCreateTemplate({
    concept: "Loan", category: "loan", amount_breakdown_mode: "detailed",
    planned_principal_eur: 0.30000000000000004, planned_interest_eur: 0.2, planned_other_fees_eur: 0.5,
    planned_total_eur: 1, start_date: "2026-01-01", end_date: "2026-12-01", frequency_interval: 1,
  });
  assert.equal(template.planned_principal_eur, 0.3);
  const replacement = validateReplacementPlan({
    amount_breakdown_mode: "detailed", planned_principal_eur: 0.30000000000000004,
    planned_interest_eur: 0.2, planned_other_fees_eur: 0.5, planned_total_eur: 1,
    installments: [{ due_date: "2026-08-10", planned_principal_eur: 0.30000000000000004, planned_interest_eur: 0.2, planned_other_fees_eur: 0.5, planned_total_eur: 1 }],
  });
  assert.equal(replacement.planned_principal_eur, 0.3);
  assert.equal(replacement.installments?.[0].planned_principal_eur, 0.3);
});

test("implicit total_only and explicit detailed installments use one effective mode", () => {
  const implicit = validateCreateObligation({
    concept: "Rent", category: "rent", planned_total_eur: 100,
    installments: [{ due_date: "2026-08-10", planned_total_eur: 100 }],
  });
  assert.equal(implicit.amount_breakdown_mode, undefined);
  assert.equal(implicit.installments?.[0].planned_total_eur, 100);
  assert.throws(() => validateCreateObligation({
    concept: "Rent", category: "rent", planned_total_eur: 100, planned_principal_eur: 100,
    installments: [{ due_date: "2026-08-10", planned_total_eur: 100 }],
  }), hasCode("TOTAL_ONLY_COMPONENTS_FORBIDDEN"));
  assert.equal(validateCreateObligation({
    concept: "Loan", category: "loan", amount_breakdown_mode: "detailed",
    planned_principal_eur: 80, planned_interest_eur: 15, planned_other_fees_eur: 5, planned_total_eur: 100,
    installments: [{ due_date: "2026-08-10", planned_principal_eur: 80, planned_interest_eur: 15, planned_other_fees_eur: 5, planned_total_eur: 100 }],
  }).installments?.length, 1);
});

test("automatic splits and effective sequences cannot create invalid installments", () => {
  assert.throws(() => validateCreateObligation({
    concept: "Tiny", category: "other", planned_total_eur: 0.01,
    installment_dates: ["2026-09-01", "2026-10-01"],
  }), hasCode("INVALID_INSTALLMENTS"));
  assert.throws(() => validateCreateObligation({
    concept: "Rent", category: "rent", planned_total_eur: 100,
    installments: [
      { due_date: "2026-09-01", planned_total_eur: 50 },
      { sequence_number: 1, due_date: "2026-10-01", planned_total_eur: 50 },
    ],
  }), hasCode("DUPLICATE_INSTALLMENT_SEQUENCE"));
});

test("amount modes and plan modality are strict", () => {
  assert.throws(() => validateCreateObligation({ ...base, planned_principal_eur: 100 }), hasCode("TOTAL_ONLY_COMPONENTS_FORBIDDEN"));
  assert.throws(() => validateCreateObligation({ ...base, amount_breakdown_mode: "detailed", planned_principal_eur: 80, planned_interest_eur: 10, planned_other_fees_eur: 5 }), hasCode("INVALID_COMPONENTS"));
  assert.throws(() => validateCreateObligation({ ...base, installments: [{ due_date: "2026-08-10", planned_total_eur: 100 }] }), hasCode("INVALID_INSTALLMENTS"));
  assert.throws(() => validateCreateObligation({
    concept: "Loan", category: "loan", amount_breakdown_mode: "detailed",
    planned_principal_eur: 80, planned_interest_eur: 15, planned_other_fees_eur: 5, planned_total_eur: 100,
    installments: [{ due_date: "2026-08-10", planned_principal_eur: 70, planned_interest_eur: 20, planned_other_fees_eur: 10, planned_total_eur: 100 }],
  }), hasCode("INVALID_COMPONENTS"));
});

test("dates, ranges, cancellation, frequency and end date are validated", () => {
  assert.throws(() => validateDate("2026-02-30", "date"), hasCode("INVALID_DATE"));
  assert.throws(() => validateTreasuryRange("2026-09-01", "2026-08-01"), hasCode("INVALID_DATE_RANGE"));
  assert.throws(() => validateCancellation({ reason: "  " }), hasCode("CANCELLATION_REASON_REQUIRED"));
  assert.throws(() => validateCreateTemplate({ concept: "Rent", category: "rent", planned_total_eur: 10, start_date: "2026-01-01", end_date: "2026-12-01", frequency_interval: 2 }), hasCode("INVALID_FREQUENCY"));
  assert.throws(() => validateCreateTemplate({ concept: "Rent", category: "rent", planned_total_eur: 10, start_date: "2026-01-01", frequency_interval: 1 }), hasCode("INVALID_DATE_RANGE"));
});

test("metadata update rejects financial and installment fields", () => {
  assert.deepEqual(validateMetadataUpdate({ concept: "New name" }), { concept: "New name" });
  assert.throws(() => validateMetadataUpdate({ planned_total_eur: 20 }), hasCode("INVALID_FIELD"));
});

test("template financial updates are partial, normalized, and do not invent fields", () => {
  assert.deepEqual(validateUpdateTemplate({ planned_principal_eur: 0.30000000000000004 }), { planned_principal_eur: 0.3 });
  assert.deepEqual(validateUpdateTemplate({ planned_interest_eur: 125.50 }), { planned_interest_eur: 125.5 });
  assert.deepEqual(validateUpdateTemplate({ planned_total_eur: 900.0000000000001 }), { planned_total_eur: 900 });
  assert.deepEqual(validateUpdateTemplate({ amount_breakdown_mode: "detailed", planned_principal_eur: 900 }), {
    amount_breakdown_mode: "detailed", planned_principal_eur: 900,
  });
  assert.throws(() => validateUpdateTemplate({ amount_breakdown_mode: "total_only", planned_interest_eur: 10 }), hasCode("TOTAL_ONLY_COMPONENTS_FORBIDDEN"));
  assert.throws(() => validateUpdateTemplate({
    amount_breakdown_mode: "detailed", planned_total_eur: 100,
    planned_principal_eur: 80, planned_interest_eur: 15, planned_other_fees_eur: 4,
  }), hasCode("INVALID_COMPONENTS"));
  const partial = validateUpdateTemplate({ planned_principal_eur: 900 });
  assert.equal("amount_breakdown_mode" in partial, false);
  assert.equal("planned_interest_eur" in partial, false);
  assert.equal("planned_other_fees_eur" in partial, false);
  assert.equal("planned_total_eur" in partial, false);
});

test("list query filters are explicit, canonical, and reject unknown parameters", () => {
  assert.throws(() => validateObligationListQuery(new URLSearchParams("category=invalid")), hasCode("INVALID_CATEGORY"));
  assert.throws(() => validateTemplateListQuery(new URLSearchParams("status=unknown")), hasCode("INVALID_STATUS"));
  assert.throws(() => validateObligationListQuery(new URLSearchParams("overdue=yes")), hasCode("INVALID_FILTER"));
  assert.throws(() => validateObligationListQuery(new URLSearchParams("templateId=bad")), hasCode("INVALID_UUID"));
  assert.throws(() => validateObligationListQuery(new URLSearchParams("other=value")), hasCode("INVALID_FIELD"));
  assert.throws(() => validateObligationListQuery(new URLSearchParams("dueFrom=2026-09-01&dueTo=2026-08-01")), hasCode("INVALID_DATE_RANGE"));
  assert.deepEqual(validateObligationListQuery(new URLSearchParams("category=&overdue=")), {});
});
