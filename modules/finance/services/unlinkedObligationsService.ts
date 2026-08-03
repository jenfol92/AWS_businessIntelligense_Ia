import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findTemplateOccurrences,
  findUnlinkedObligationById,
  findUnlinkedObligationInstallments,
  findUnlinkedObligationPayments,
  findUnlinkedObligations,
  findUnlinkedObligationTemplateById,
  findUnlinkedObligationTemplates,
  findUnlinkedPaymentAllocations,
} from "../repositories/unlinkedObligationsRepository";
import type {
  UnlinkedAmountBreakdown,
  UnlinkedAmountBreakdownMode,
  UnlinkedFrequencyInterval,
  UnlinkedInstallmentBalance,
  UnlinkedInstallmentFinancialStatus,
  UnlinkedInstallmentStatus,
  UnlinkedInstallmentTemporalCondition,
  UnlinkedObligationCategory,
  UnlinkedObligationDetail,
  UnlinkedObligationFinancialStatus,
  UnlinkedObligationLifecycleStatus,
  UnlinkedObligationListFilters,
  UnlinkedObligationListItem,
  UnlinkedObligationOccurrenceSummary,
  UnlinkedObligationOriginType,
  UnlinkedObligationPayment,
  UnlinkedObligationTemplate,
  UnlinkedObligationTemplateDetail,
  UnlinkedPaymentAllocation,
  UnlinkedTemplateListFilters,
  UnlinkedTemplateStatus,
} from "../types/unlinkedObligations.types";

type RawRow = Record<string, unknown>;

export class UnlinkedObligationsDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "UnlinkedObligationsDomainError";
    this.code = code;
  }
}

const CATEGORIES = ["payroll", "social_security", "mortgage", "loan", "rent", "insurance", "taxes", "utilities", "professional_services", "other"] as const;
const ORIGINS = ["one_off", "recurring_occurrence"] as const;
const LIFECYCLES = ["active", "cancelled"] as const;
const MODES = ["total_only", "detailed"] as const;
const OBLIGATION_STATUSES = ["pending", "partial", "paid", "cancelled"] as const;
const INSTALLMENT_STATUSES = ["pending", "partial", "paid", "cancelled", "superseded"] as const;
const INSTALLMENT_ROW_STATUSES = ["active", "cancelled", "superseded"] as const;
const TEMPORAL_CONDITIONS = ["current", "due_soon", "overdue"] as const;
const TEMPLATE_STATUSES = ["active", "paused", "ended", "cancelled"] as const;

function invalid(code: string, message: string): never {
  throw new UnlinkedObligationsDomainError(code, message);
}

function oneOf<T extends string>(value: unknown, values: readonly T[], field: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) invalid("INVALID_ROW", `${field} is invalid`);
  return value as T;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid("INVALID_ROW", `${field} is required`);
  return value.trim();
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function toSafeNumber(value: unknown, field = "numeric"): number {
  if ((typeof value !== "string" && typeof value !== "number")
    || (typeof value === "string" && value.trim() === "")) {
    invalid("INVALID_NUMERIC", `${field} must be numeric`);
  }
  const result = Number(value);
  if (!Number.isFinite(result)) invalid("INVALID_NUMERIC", `${field} must be finite`);
  return result;
}

export function toNullableSafeNumber(value: unknown, field = "numeric"): number | null {
  return value === null || value === undefined ? null : toSafeNumber(value, field);
}

function integer(value: unknown, field: string): number {
  const result = toSafeNumber(value, field);
  if (!Number.isInteger(result)) invalid("INVALID_NUMERIC", `${field} must be an integer`);
  return result;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") invalid("INVALID_ROW", `${field} must be boolean`);
  return value;
}

export function assertUuid(value: unknown, field = "id"): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    invalid("INVALID_UUID", `${field} must be a valid UUID`);
  }
  return normalized;
}

export function assertDateOnly(value: unknown, field = "date"): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid("INVALID_DATE", `${field} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid("INVALID_DATE", `${field} is not a real date`);
  return value;
}

function nullableDate(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : assertDateOnly(value, field);
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) invalid("INVALID_ROW", `${field} must be a timestamp`);
  return value;
}

function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : timestamp(value, field);
}

export function normalizeSearchQuery(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") invalid("INVALID_FILTER", "q must be text");
  const normalized = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  if (normalized.length > 120) invalid("INVALID_FILTER", "q is too long");
  return normalized;
}

export function normalizeUnlinkedObligationFilters(filters: UnlinkedObligationListFilters = {}): UnlinkedObligationListFilters {
  const normalized: UnlinkedObligationListFilters = {};
  const q = normalizeSearchQuery(filters.q);
  if (q) normalized.q = q;
  if (filters.category) normalized.category = oneOf(filters.category, CATEGORIES, "category");
  if (filters.financialStatus) normalized.financialStatus = oneOf(filters.financialStatus, OBLIGATION_STATUSES, "financialStatus");
  if (filters.lifecycleStatus) normalized.lifecycleStatus = oneOf(filters.lifecycleStatus, LIFECYCLES, "lifecycleStatus");
  if (filters.overdue !== undefined) {
    if (typeof filters.overdue !== "boolean") invalid("INVALID_FILTER", "overdue must be boolean");
    normalized.overdue = filters.overdue;
  }
  if (filters.dueFrom) normalized.dueFrom = assertDateOnly(filters.dueFrom, "dueFrom");
  if (filters.dueTo) normalized.dueTo = assertDateOnly(filters.dueTo, "dueTo");
  if (normalized.dueFrom && normalized.dueTo && normalized.dueFrom > normalized.dueTo) invalid("INVALID_DATE_RANGE", "dueFrom cannot be after dueTo");
  if (filters.originType) normalized.originType = oneOf(filters.originType, ORIGINS, "originType");
  if (filters.templateId) normalized.templateId = assertUuid(filters.templateId, "templateId");
  return normalized;
}

function normalizeTemplateFilters(filters: UnlinkedTemplateListFilters = {}): UnlinkedTemplateListFilters {
  const normalized: UnlinkedTemplateListFilters = {};
  const q = normalizeSearchQuery(filters.q);
  if (q) normalized.q = q;
  if (filters.category) normalized.category = oneOf(filters.category, CATEGORIES, "category");
  if (filters.status) normalized.status = oneOf(filters.status, TEMPLATE_STATUSES, "status");
  return normalized;
}

export function mapUnlinkedObligationListItem(row: RawRow): UnlinkedObligationListItem {
  return {
    id: assertUuid(row.obligation_id, "obligation_id"),
    templateId: row.template_id == null ? null : assertUuid(row.template_id, "template_id"),
    occurrencePeriod: nullableDate(row.occurrence_period, "occurrence_period"),
    originType: oneOf(row.origin_type, ORIGINS, "origin_type") as UnlinkedObligationOriginType,
    concept: text(row.concept, "concept"),
    category: oneOf(row.category, CATEGORIES, "category") as UnlinkedObligationCategory,
    counterpartyName: nullableText(row.counterparty_name),
    description: nullableText(row.description),
    lifecycleStatus: oneOf(row.lifecycle_status, LIFECYCLES, "lifecycle_status") as UnlinkedObligationLifecycleStatus,
    amountBreakdownMode: oneOf(row.amount_breakdown_mode, MODES, "amount_breakdown_mode") as UnlinkedAmountBreakdownMode,
    plannedTotalEur: toSafeNumber(row.planned_total_eur, "planned_total_eur"),
    paidTotalEur: toSafeNumber(row.paid_total_eur, "paid_total_eur"),
    outstandingTotalEur: toSafeNumber(row.outstanding_total_eur, "outstanding_total_eur"),
    financialStatus: oneOf(row.financial_status, OBLIGATION_STATUSES, "financial_status") as UnlinkedObligationFinancialStatus,
    hasOverdueInstallment: boolean(row.has_overdue_installment, "has_overdue_installment"),
    nextPendingDueDate: nullableDate(row.next_pending_due_date, "next_pending_due_date"),
    installmentCount: integer(row.installment_count, "installment_count"),
    paidInstallmentCount: integer(row.paid_installment_count, "paid_installment_count"),
    partialInstallmentCount: integer(row.partial_installment_count, "partial_installment_count"),
    pendingInstallmentCount: integer(row.pending_installment_count, "pending_installment_count"),
  };
}

export function mapUnlinkedInstallmentBalance(row: RawRow): UnlinkedInstallmentBalance {
  return {
    id: assertUuid(row.installment_id, "installment_id"),
    obligationId: assertUuid(row.obligation_id, "obligation_id"),
    planRevision: integer(row.plan_revision, "plan_revision"),
    sequenceNumber: integer(row.sequence_number, "sequence_number"),
    dueDate: assertDateOnly(row.due_date, "due_date"),
    status: oneOf(row.installment_status, INSTALLMENT_ROW_STATUSES, "installment_status") as UnlinkedInstallmentStatus,
    amountBreakdownMode: oneOf(row.amount_breakdown_mode, MODES, "amount_breakdown_mode") as UnlinkedAmountBreakdownMode,
    plannedPrincipalEur: toNullableSafeNumber(row.planned_principal_eur, "planned_principal_eur"),
    plannedInterestEur: toNullableSafeNumber(row.planned_interest_eur, "planned_interest_eur"),
    plannedOtherFeesEur: toNullableSafeNumber(row.planned_other_fees_eur, "planned_other_fees_eur"),
    plannedTotalEur: toSafeNumber(row.planned_total_eur, "planned_total_eur"),
    allocatedPrincipalEur: toNullableSafeNumber(row.allocated_principal_eur, "allocated_principal_eur"),
    allocatedInterestEur: toNullableSafeNumber(row.allocated_interest_eur, "allocated_interest_eur"),
    allocatedOtherFeesEur: toNullableSafeNumber(row.allocated_other_fees_eur, "allocated_other_fees_eur"),
    allocatedTotalEur: toSafeNumber(row.allocated_total_eur, "allocated_total_eur"),
    outstandingTotalEur: toSafeNumber(row.outstanding_total_eur, "outstanding_total_eur"),
    financialStatus: oneOf(row.financial_status, INSTALLMENT_STATUSES, "financial_status") as UnlinkedInstallmentFinancialStatus,
    temporalCondition: oneOf(row.temporal_condition, TEMPORAL_CONDITIONS, "temporal_condition") as UnlinkedInstallmentTemporalCondition,
  };
}

function amountFromRow(row: RawRow, prefix: "planned" | "actual" | "allocated" = "planned"): UnlinkedAmountBreakdown {
  const totalKey = `${prefix}_total_eur`;
  return {
    amountBreakdownMode: oneOf(row.amount_breakdown_mode, MODES, "amount_breakdown_mode"),
    principalEur: toNullableSafeNumber(row[`${prefix}_principal_eur`], `${prefix}_principal_eur`),
    interestEur: toNullableSafeNumber(row[`${prefix}_interest_eur`], `${prefix}_interest_eur`),
    otherFeesEur: toNullableSafeNumber(row[`${prefix}_other_fees_eur`], `${prefix}_other_fees_eur`),
    totalEur: toSafeNumber(row[totalKey], totalKey),
  };
}

export function mapPayment(row: RawRow): UnlinkedObligationPayment {
  const sourceType = oneOf(row.source_type, ["cash_account", "credit_line"] as const, "source_type");
  const cashAccountId = row.cash_account_id == null ? null : assertUuid(row.cash_account_id, "cash_account_id");
  const creditLineId = row.credit_line_id == null ? null : assertUuid(row.credit_line_id, "credit_line_id");
  if ((sourceType === "cash_account" && (!cashAccountId || creditLineId))
    || (sourceType === "credit_line" && (!creditLineId || cashAccountId))) {
    invalid("INVALID_ROW", "payment funding identity is inconsistent with source_type");
  }
  return {
    id: assertUuid(row.id, "payment.id"), obligationId: assertUuid(row.obligation_id, "payment.obligation_id"),
    paidAt: timestamp(row.paid_at, "paid_at"), amountBreakdownMode: oneOf(row.amount_breakdown_mode, MODES, "amount_breakdown_mode"),
    actualPrincipalEur: toNullableSafeNumber(row.actual_principal_eur), actualInterestEur: toNullableSafeNumber(row.actual_interest_eur),
    actualOtherFeesEur: toNullableSafeNumber(row.actual_other_fees_eur), actualTotalEur: toSafeNumber(row.actual_total_eur),
    bankFeeEur: toSafeNumber(row.bank_fee_eur), fundedTotalEur: toSafeNumber(row.funded_total_eur),
    sourceType, cashAccountId, creditLineId,
    cashMovementId: row.cash_movement_id == null ? null : assertUuid(row.cash_movement_id, "cash_movement_id"),
    creditLineMovementId: row.credit_line_movement_id == null ? null : assertUuid(row.credit_line_movement_id, "credit_line_movement_id"),
    repaymentGroupId: row.repayment_group_id == null ? null : assertUuid(row.repayment_group_id, "repayment_group_id"),
    bankReference: nullableText(row.bank_reference), notes: nullableText(row.notes),
    status: oneOf(row.status, ["posted", "reversed"] as const, "payment.status"), createdAt: timestamp(row.created_at, "created_at"),
  };
}

function mapAllocation(row: RawRow): UnlinkedPaymentAllocation {
  return {
    id: assertUuid(row.id, "allocation.id"), paymentId: assertUuid(row.payment_id, "payment_id"),
    installmentId: assertUuid(row.installment_id, "installment_id"),
    amountBreakdownMode: oneOf(row.amount_breakdown_mode, MODES, "amount_breakdown_mode"),
    allocatedPrincipalEur: toNullableSafeNumber(row.allocated_principal_eur), allocatedInterestEur: toNullableSafeNumber(row.allocated_interest_eur),
    allocatedOtherFeesEur: toNullableSafeNumber(row.allocated_other_fees_eur), allocatedTotalEur: toSafeNumber(row.allocated_total_eur),
    createdAt: timestamp(row.created_at, "created_at"),
  };
}

export function mapUnlinkedObligationTemplate(row: RawRow): UnlinkedObligationTemplate {
  const interval = integer(row.frequency_interval, "frequency_interval");
  if (interval !== 1 && interval !== 3 && interval !== 12) invalid("INVALID_ROW", "frequency_interval is invalid");
  if (row.frequency_unit !== "month") invalid("INVALID_ROW", "frequency_unit is invalid");
  return {
    id: assertUuid(row.id), concept: text(row.concept, "concept"), category: oneOf(row.category, CATEGORIES, "category"),
    counterpartyName: nullableText(row.counterparty_name), description: nullableText(row.description), amount: amountFromRow(row),
    startDate: assertDateOnly(row.start_date, "start_date"), endDate: assertDateOnly(row.end_date, "end_date"),
    anchorDay: integer(row.anchor_day, "anchor_day"), anchorMonth: integer(row.anchor_month, "anchor_month"),
    frequencyUnit: "month", frequencyInterval: interval as UnlinkedFrequencyInterval,
    status: oneOf(row.status, TEMPLATE_STATUSES, "status") as UnlinkedTemplateStatus,
    createdAt: timestamp(row.created_at, "created_at"), updatedAt: timestamp(row.updated_at, "updated_at"),
  };
}

export async function listUnlinkedObligations(filters: UnlinkedObligationListFilters = {}, client?: SupabaseClient) {
  const rows = await findUnlinkedObligations(normalizeUnlinkedObligationFilters(filters), client);
  return rows.map(mapUnlinkedObligationListItem);
}

export async function getUnlinkedObligationDetail(id: string, client?: SupabaseClient): Promise<UnlinkedObligationDetail> {
  const validId = assertUuid(id);
  const found = await findUnlinkedObligationById(validId, client);
  if (!found) invalid("NOT_FOUND", "unlinked obligation not found");
  const [installmentRows, paymentRows] = await Promise.all([
    findUnlinkedObligationInstallments(validId, {}, client),
    findUnlinkedObligationPayments(validId, client),
  ]);
  const allocations = await findUnlinkedPaymentAllocations(
    installmentRows.map((row) => assertUuid(row.installment_id, "installment_id")), client,
  );
  const base = found.obligation;
  return {
    id: validId, templateId: base.template_id == null ? null : assertUuid(base.template_id, "template_id"),
    occurrencePeriod: nullableDate(base.occurrence_period, "occurrence_period"), originType: oneOf(base.origin_type, ORIGINS, "origin_type"),
    concept: text(base.concept, "concept"), category: oneOf(base.category, CATEGORIES, "category"),
    counterpartyName: nullableText(base.counterparty_name), description: nullableText(base.description),
    lifecycleStatus: oneOf(base.lifecycle_status, LIFECYCLES, "lifecycle_status"), cancellationReason: nullableText(base.cancellation_reason),
    cancelledAt: nullableTimestamp(base.cancelled_at, "cancelled_at"), createdAt: timestamp(base.created_at, "created_at"),
    updatedAt: timestamp(base.updated_at, "updated_at"), amount: amountFromRow(base),
    balance: mapUnlinkedObligationListItem(found.balance), installments: installmentRows.map(mapUnlinkedInstallmentBalance),
    payments: paymentRows.map(mapPayment), allocations: allocations.map(mapAllocation),
  };
}

export async function listUnlinkedObligationTemplates(filters: UnlinkedTemplateListFilters = {}, client?: SupabaseClient) {
  const rows = await findUnlinkedObligationTemplates(normalizeTemplateFilters(filters), client);
  return rows.map(mapUnlinkedObligationTemplate);
}

export async function getUnlinkedObligationTemplateDetail(id: string, client?: SupabaseClient): Promise<UnlinkedObligationTemplateDetail> {
  const validId = assertUuid(id);
  const [templateRow, occurrenceRows] = await Promise.all([
    findUnlinkedObligationTemplateById(validId, client), findTemplateOccurrences(validId, client),
  ]);
  if (!templateRow) invalid("NOT_FOUND", "unlinked obligation template not found");
  const occurrences = occurrenceRows.map(mapUnlinkedObligationListItem).map((item) => {
    if (item.templateId !== validId || item.originType !== "recurring_occurrence" || !item.occurrencePeriod) {
      invalid("INVALID_ROW", "template occurrence is inconsistent");
    }
    return item as UnlinkedObligationOccurrenceSummary;
  });
  return { template: mapUnlinkedObligationTemplate(templateRow), occurrences };
}
