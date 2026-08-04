import type {
  CreateUnlinkedObligationInput,
  CreateUnlinkedObligationTemplateInput,
  ReplaceUnlinkedInstallmentPlanInput,
  UnlinkedAmountBreakdownMode,
  UnlinkedAmountInput,
  UnlinkedInstallmentInput,
  UnlinkedInstallmentPlanInput,
  UnlinkedObligationCategory,
  UnlinkedObligationListFilters,
  UnlinkedTemplateStatus,
  UnlinkedTemplateListFilters,
  UpdateUnlinkedObligationMetadataInput,
  UpdateUnlinkedObligationTemplateInput,
} from "../types/unlinkedObligations.types";
import { UnlinkedObligationsApiError } from "./unlinkedObligationsApiErrors";

type JsonObject = Record<string, unknown>;
const CATEGORIES = ["payroll", "social_security", "mortgage", "loan", "rent", "insurance", "taxes", "utilities", "professional_services", "other"] as const;
const TEMPLATE_STATUSES = ["active", "paused", "ended", "cancelled"] as const;
const AMOUNT_FIELDS = ["amount_breakdown_mode", "planned_principal_eur", "planned_interest_eur", "planned_other_fees_eur", "planned_total_eur"] as const;
const PLAN_FIELDS = ["installments", "installment_dates"] as const;

function fail(code: string, message: string): never {
  throw new UnlinkedObligationsApiError(code, message, 422);
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_PAYLOAD", "Payload must be an object");
  return value as JsonObject;
}

function only(value: JsonObject, allowed: readonly string[]) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail("INVALID_FIELD", `Unknown field: ${unknown[0]}`);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) fail(field === "concept" ? "INVALID_CONCEPT" : "INVALID_FIELD", `${field} is required`);
  return value.trim();
}

function nullableText(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") fail("INVALID_FIELD", `${field} must be text or null`);
  return value.trim() || null;
}

export function validateUuid(value: unknown, field = "id"): string {
  const id = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) fail("INVALID_UUID", `${field} must be a valid UUID`);
  return id;
}

export function validateDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("INVALID_DATE", `${field} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail("INVALID_DATE", `${field} must be a real date`);
  return value;
}

function money(value: unknown, field: string, positive: boolean): number {
  if (typeof value !== "number" || !Number.isFinite(value) || (positive ? value <= 0 : value < 0)) fail("INVALID_AMOUNT", `${field} is invalid`);
  const cents = Math.round(value * 100);
  const normalized = cents / 100;
  if (Math.abs(value - normalized) > 1e-9) fail("INVALID_AMOUNT", `${field} must have at most two decimals`);
  return normalized;
}

function category(value: unknown): UnlinkedObligationCategory {
  if (typeof value !== "string" || !CATEGORIES.includes(value as UnlinkedObligationCategory)) fail("INVALID_CATEGORY", "category is invalid");
  return value as UnlinkedObligationCategory;
}

function mode(value: unknown, required: boolean): UnlinkedAmountBreakdownMode {
  const normalized = value === undefined && !required ? "total_only" : value;
  if (normalized !== "total_only" && normalized !== "detailed") fail("INVALID_AMOUNT", "amount_breakdown_mode is invalid");
  return normalized;
}

function validateAmount(input: JsonObject, modeRequired: boolean, totalRequired = true, resolvedMode?: UnlinkedAmountBreakdownMode): UnlinkedAmountInput {
  const amountMode = resolvedMode ?? mode(input.amount_breakdown_mode, modeRequired);
  if (totalRequired && input.planned_total_eur === undefined) fail("INVALID_AMOUNT", "planned_total_eur is required");
  const total = input.planned_total_eur === undefined ? undefined : money(input.planned_total_eur, "planned_total_eur", true);
  const keys = ["planned_principal_eur", "planned_interest_eur", "planned_other_fees_eur"] as const;
  const components = keys.map((key) => input[key]);
  const normalizedComponents: Array<number | null | undefined> = components.map((value, index) => {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return money(value, keys[index], false);
  });
  if (amountMode === "total_only") {
    if (components.some((value) => value !== undefined && value !== null)) fail("TOTAL_ONLY_COMPONENTS_FORBIDDEN", "total_only components must be absent or null");
  } else {
    if (components.some((value) => value === undefined || value === null)) fail("INVALID_COMPONENTS", "detailed components are required");
    const numbers = normalizedComponents as number[];
    if (total !== undefined && Math.round(numbers.reduce((sum, value) => sum + value, 0) * 100) !== Math.round(total * 100)) {
      fail("INVALID_COMPONENTS", "detailed components must add to total");
    }
  }
  return {
    ...(input.amount_breakdown_mode !== undefined || modeRequired ? { amount_breakdown_mode: amountMode } : {}),
    ...(input.planned_principal_eur !== undefined ? { planned_principal_eur: normalizedComponents[0] as number | null } : {}),
    ...(input.planned_interest_eur !== undefined ? { planned_interest_eur: normalizedComponents[1] as number | null } : {}),
    ...(input.planned_other_fees_eur !== undefined ? { planned_other_fees_eur: normalizedComponents[2] as number | null } : {}),
    ...(total !== undefined ? { planned_total_eur: total } : {}),
  } as UnlinkedAmountInput;
}

function validatePartialTemplateAmount(input: JsonObject): Partial<UnlinkedAmountInput> {
  const result: Partial<UnlinkedAmountInput> = {};
  const rawMode = input.amount_breakdown_mode;
  if (rawMode !== undefined) result.amount_breakdown_mode = mode(rawMode, true);
  if (input.planned_total_eur !== undefined) {
    result.planned_total_eur = money(input.planned_total_eur, "planned_total_eur", true);
  }
  const componentFields = ["planned_principal_eur", "planned_interest_eur", "planned_other_fees_eur"] as const;
  for (const field of componentFields) {
    const value = input[field];
    if (value !== undefined) result[field] = value === null ? null : money(value, field, false);
  }
  if (result.amount_breakdown_mode === "total_only"
      && componentFields.some((field) => result[field] !== undefined && result[field] !== null)) {
    fail("TOTAL_ONLY_COMPONENTS_FORBIDDEN", "total_only components must be absent or null");
  }
  const hasCompleteDetailedBlock = result.amount_breakdown_mode === "detailed"
    && result.planned_total_eur !== undefined
    && componentFields.every((field) => typeof result[field] === "number");
  if (hasCompleteDetailedBlock) {
    const componentCents = componentFields.reduce((sum, field) => sum + Math.round((result[field] as number) * 100), 0);
    if (componentCents !== Math.round(result.planned_total_eur! * 100)) {
      fail("INVALID_COMPONENTS", "detailed components must add to total");
    }
  }
  return result;
}

function validatePlan(input: JsonObject, amountMode: UnlinkedAmountBreakdownMode): UnlinkedInstallmentPlanInput {
  const hasInstallments = input.installments !== undefined;
  const hasDates = input.installment_dates !== undefined;
  if (hasInstallments === hasDates) fail("INVALID_INSTALLMENTS", "Exactly one installment plan mode is required");
  if (hasDates) {
    if (!Array.isArray(input.installment_dates) || input.installment_dates.length === 0) fail("INVALID_INSTALLMENTS", "installment_dates cannot be empty");
    const totalCents = Math.round(money(input.planned_total_eur, "planned_total_eur", true) * 100);
    if (Math.floor(totalCents / input.installment_dates.length) <= 0) fail("INVALID_INSTALLMENTS", "automatic split would create a zero installment");
    return { installment_dates: input.installment_dates.map((date, index) => validateDate(date, `installment_dates[${index}]`)) };
  }
  if (!Array.isArray(input.installments) || input.installments.length === 0) fail("INVALID_INSTALLMENTS", "installments cannot be empty");
  const sequences = new Set<number>();
  const installments = input.installments.map((raw, index): UnlinkedInstallmentInput => {
    const row = object(raw);
    only(row, ["sequence_number", "due_date", "planned_principal_eur", "planned_interest_eur", "planned_other_fees_eur", "planned_total_eur"]);
    const sequence = row.sequence_number;
    if (sequence !== undefined && (!Number.isInteger(sequence) || (sequence as number) <= 0)) fail("INVALID_INSTALLMENTS", "sequence_number must be a positive integer");
    const effectiveSequence = typeof sequence === "number" ? sequence : index + 1;
    if (sequences.has(effectiveSequence)) fail("DUPLICATE_INSTALLMENT_SEQUENCE", "effective sequence_number must be unique");
    sequences.add(effectiveSequence);
    const rowAmount = validateAmount(row, true, true, amountMode);
    const { amount_breakdown_mode: _mode, ...installmentAmount } = rowAmount;
    return {
      ...(typeof sequence === "number" ? { sequence_number: sequence } : {}),
      due_date: validateDate(row.due_date, `installments[${index}].due_date`),
      ...installmentAmount,
    };
  });
  const total = money(input.planned_total_eur, "planned_total_eur", true);
  if (Math.round(installments.reduce((sum, item) => sum + item.planned_total_eur, 0) * 100) !== Math.round(total * 100)) {
    fail("INSTALLMENT_TOTAL_SUM_MISMATCH", "installment totals must add to planned_total_eur");
  }
  if (amountMode === "detailed") {
    for (const field of ["planned_principal_eur", "planned_interest_eur", "planned_other_fees_eur"] as const) {
      const expected = money(input[field], field, false);
      const actual = installments.reduce((sum, item) => sum + (item[field] ?? 0), 0);
      if (Math.round(actual * 100) !== Math.round(expected * 100)) {
        fail("INVALID_COMPONENTS", `installment ${field} values must add to the obligation value`);
      }
    }
  }
  return { installments };
}

export function validateCreateObligation(value: unknown): CreateUnlinkedObligationInput {
  const input = object(value);
  only(input, ["concept", "category", "counterparty_name", "description", ...AMOUNT_FIELDS, ...PLAN_FIELDS]);
  const amountMode = mode(input.amount_breakdown_mode, false);
  return {
    concept: requiredText(input.concept, "concept"), category: category(input.category),
    ...(input.counterparty_name !== undefined ? { counterparty_name: nullableText(input.counterparty_name, "counterparty_name") } : {}),
    ...(input.description !== undefined ? { description: nullableText(input.description, "description") } : {}),
    ...validateAmount(input, false, true, amountMode), ...validatePlan(input, amountMode),
  };
}

export function validateMetadataUpdate(value: unknown): UpdateUnlinkedObligationMetadataInput {
  const input = object(value);
  only(input, ["concept", "category", "counterparty_name", "description"]);
  if (!Object.keys(input).length) fail("INVALID_PAYLOAD", "At least one metadata field is required");
  return {
    ...(input.concept !== undefined ? { concept: requiredText(input.concept, "concept") } : {}),
    ...(input.category !== undefined ? { category: category(input.category) } : {}),
    ...(input.counterparty_name !== undefined ? { counterparty_name: nullableText(input.counterparty_name, "counterparty_name") } : {}),
    ...(input.description !== undefined ? { description: nullableText(input.description, "description") } : {}),
  };
}

export function validateReplacementPlan(value: unknown): ReplaceUnlinkedInstallmentPlanInput {
  const input = object(value);
  only(input, [...AMOUNT_FIELDS, ...PLAN_FIELDS]);
  const amountMode = mode(input.amount_breakdown_mode, true);
  return { ...validateAmount(input, true, true, amountMode), ...validatePlan(input, amountMode) } as ReplaceUnlinkedInstallmentPlanInput;
}

export function validateCancellation(value: unknown): { reason: string } {
  const input = object(value); only(input, ["reason"]);
  if (typeof input.reason !== "string" || !input.reason.trim()) fail("CANCELLATION_REASON_REQUIRED", "reason is required");
  return { reason: input.reason.trim() };
}

export function validateCreateTemplate(value: unknown): CreateUnlinkedObligationTemplateInput {
  const input = object(value);
  only(input, ["concept", "category", "counterparty_name", "description", ...AMOUNT_FIELDS, "start_date", "end_date", "frequency_unit", "frequency_interval"]);
  const startDate = validateDate(input.start_date, "start_date");
  if (input.end_date === undefined) fail("INVALID_DATE_RANGE", "end_date is required");
  const endDate = validateDate(input.end_date, "end_date");
  if (startDate > endDate) fail("INVALID_DATE_RANGE", "end_date cannot be before start_date");
  if (![1, 3, 12].includes(input.frequency_interval as number)) fail("INVALID_FREQUENCY", "frequency_interval must be 1, 3, or 12");
  if (input.frequency_unit !== undefined && input.frequency_unit !== "month") fail("INVALID_FREQUENCY", "frequency_unit must be month");
  return {
    concept: requiredText(input.concept, "concept"), category: category(input.category),
    ...(input.counterparty_name !== undefined ? { counterparty_name: nullableText(input.counterparty_name, "counterparty_name") } : {}),
    ...(input.description !== undefined ? { description: nullableText(input.description, "description") } : {}),
    ...validateAmount(input, false), start_date: startDate, end_date: endDate,
    ...(input.frequency_unit !== undefined ? { frequency_unit: "month" as const } : {}),
    frequency_interval: input.frequency_interval as 1 | 3 | 12,
  };
}

export function validateUpdateTemplate(value: unknown): UpdateUnlinkedObligationTemplateInput {
  const input = object(value);
  only(input, ["concept", "category", "counterparty_name", "description", ...AMOUNT_FIELDS, "end_date", "frequency_interval", "status"]);
  if (!Object.keys(input).length) fail("INVALID_PAYLOAD", "At least one template field is required");
  if (input.frequency_interval !== undefined && ![1, 3, 12].includes(input.frequency_interval as number)) fail("INVALID_FREQUENCY", "frequency_interval must be 1, 3, or 12");
  if (input.status !== undefined && !TEMPLATE_STATUSES.includes(input.status as UnlinkedTemplateStatus)) fail("INVALID_STATUS", "status is invalid");
  const hasAmount = AMOUNT_FIELDS.some((field) => input[field] !== undefined);
  const amount = hasAmount ? validatePartialTemplateAmount(input) : {};
  return {
    ...(input.concept !== undefined ? { concept: requiredText(input.concept, "concept") } : {}),
    ...(input.category !== undefined ? { category: category(input.category) } : {}),
    ...(input.counterparty_name !== undefined ? { counterparty_name: nullableText(input.counterparty_name, "counterparty_name") } : {}),
    ...(input.description !== undefined ? { description: nullableText(input.description, "description") } : {}),
    ...amount,
    ...(input.end_date !== undefined ? { end_date: validateDate(input.end_date, "end_date") } : {}),
    ...(input.frequency_interval !== undefined ? { frequency_interval: input.frequency_interval as 1 | 3 | 12 } : {}),
    ...(input.status !== undefined ? { status: input.status as UnlinkedTemplateStatus } : {}),
  };
}

export function validateGeneration(value: unknown): { throughDate: string } {
  const input = object(value); only(input, ["throughDate"]);
  return { throughDate: validateDate(input.throughDate, "throughDate") };
}

export function validateTreasuryRange(dueFrom: unknown, dueTo: unknown) {
  const from = dueFrom == null || dueFrom === "" ? null : validateDate(dueFrom, "dueFrom");
  const to = dueTo == null || dueTo === "" ? null : validateDate(dueTo, "dueTo");
  if (from && to && from > to) fail("INVALID_DATE_RANGE", "dueFrom cannot be after dueTo");
  return { dueFrom: from, dueTo: to };
}

function queryValue(query: URLSearchParams, key: string): string | undefined {
  const value = query.get(key)?.trim();
  return value ? value : undefined;
}

function validateQueryKeys(query: URLSearchParams, allowed: readonly string[]) {
  query.forEach((_value, key) => {
    if (!allowed.includes(key)) fail("INVALID_FIELD", `Unknown query parameter: ${key}`);
  });
}

export function validateObligationListQuery(query: URLSearchParams): UnlinkedObligationListFilters {
  const allowed = ["q", "category", "financialStatus", "lifecycleStatus", "overdue", "dueFrom", "dueTo", "originType", "templateId"];
  validateQueryKeys(query, allowed);
  const result: UnlinkedObligationListFilters = {};
  const q = queryValue(query, "q"); if (q) result.q = q;
  const categoryValue = queryValue(query, "category"); if (categoryValue) result.category = category(categoryValue);
  const financialStatus = queryValue(query, "financialStatus");
  if (financialStatus && !["pending", "partial", "paid", "cancelled"].includes(financialStatus)) fail("INVALID_STATUS", "financialStatus is invalid");
  if (financialStatus) result.financialStatus = financialStatus as UnlinkedObligationListFilters["financialStatus"];
  const lifecycleStatus = queryValue(query, "lifecycleStatus");
  if (lifecycleStatus && lifecycleStatus !== "active" && lifecycleStatus !== "cancelled") fail("INVALID_STATUS", "lifecycleStatus is invalid");
  if (lifecycleStatus) result.lifecycleStatus = lifecycleStatus as NonNullable<UnlinkedObligationListFilters["lifecycleStatus"]>;
  const overdue = queryValue(query, "overdue");
  if (overdue && overdue !== "true" && overdue !== "false") fail("INVALID_FILTER", "overdue must be true or false");
  if (overdue) result.overdue = overdue === "true";
  const dueFrom = queryValue(query, "dueFrom"); if (dueFrom) result.dueFrom = validateDate(dueFrom, "dueFrom");
  const dueTo = queryValue(query, "dueTo"); if (dueTo) result.dueTo = validateDate(dueTo, "dueTo");
  if (result.dueFrom && result.dueTo && result.dueFrom > result.dueTo) fail("INVALID_DATE_RANGE", "dueFrom cannot be after dueTo");
  const originType = queryValue(query, "originType");
  if (originType && originType !== "one_off" && originType !== "recurring_occurrence") fail("INVALID_ORIGIN", "originType is invalid");
  if (originType) result.originType = originType as NonNullable<UnlinkedObligationListFilters["originType"]>;
  const templateId = queryValue(query, "templateId"); if (templateId) result.templateId = validateUuid(templateId, "templateId");
  return result;
}

export function validateTemplateListQuery(query: URLSearchParams): UnlinkedTemplateListFilters {
  validateQueryKeys(query, ["q", "category", "status"]);
  const result: UnlinkedTemplateListFilters = {};
  const q = queryValue(query, "q"); if (q) result.q = q;
  const categoryValue = queryValue(query, "category"); if (categoryValue) result.category = category(categoryValue);
  const status = queryValue(query, "status");
  if (status && !TEMPLATE_STATUSES.includes(status as UnlinkedTemplateStatus)) fail("INVALID_STATUS", "status is invalid");
  if (status) result.status = status as UnlinkedTemplateStatus;
  return result;
}
