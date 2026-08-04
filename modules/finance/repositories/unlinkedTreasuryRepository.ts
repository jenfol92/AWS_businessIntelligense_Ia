import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnlinkedTreasuryCommitment } from "../types/unlinkedObligations.types";
import { UnlinkedObligationsCommandRepositoryError } from "./unlinkedObligationsCommandsRepository";
import { assertDateOnly, assertUuid, toSafeNumber } from "../services/unlinkedObligationsService";

const SAFE_KEYS = [
  "obligation_id", "installment_id", "template_id", "origin_type", "concept", "category", "due_date",
  "planned_total_eur", "allocated_total_eur", "outstanding_total_eur", "financial_status",
  "temporal_condition", "has_overdue_installment",
] as const;
const CATEGORIES = ["payroll", "social_security", "mortgage", "loan", "rent", "insurance", "taxes", "utilities", "professional_services", "other"];

export function mapUnlinkedTreasuryCommitment(row: Record<string, unknown>): UnlinkedTreasuryCommitment {
  const keys = Object.keys(row).sort();
  const expected = [...SAFE_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("INVALID_TREASURY_ROW: unexpected aggregate columns");
  }
  if (row.origin_type !== "one_off" && row.origin_type !== "recurring_occurrence") throw new Error("INVALID_TREASURY_ROW: origin_type");
  if (typeof row.concept !== "string" || !row.concept.trim()) throw new Error("INVALID_TREASURY_ROW: concept");
  if (typeof row.category !== "string" || !CATEGORIES.includes(row.category)) throw new Error("INVALID_TREASURY_ROW: category");
  if (!["pending", "partial", "paid", "cancelled", "superseded"].includes(String(row.financial_status))) throw new Error("INVALID_TREASURY_ROW: financial_status");
  if (!["current", "due_soon", "overdue"].includes(String(row.temporal_condition))) throw new Error("INVALID_TREASURY_ROW: temporal_condition");
  if (typeof row.has_overdue_installment !== "boolean") throw new Error("INVALID_TREASURY_ROW: has_overdue_installment");
  return {
    obligationId: assertUuid(row.obligation_id, "obligation_id"),
    installmentId: assertUuid(row.installment_id, "installment_id"),
    templateId: row.template_id == null ? null : assertUuid(row.template_id, "template_id"),
    originType: row.origin_type,
    concept: row.concept.trim(),
    category: row.category as UnlinkedTreasuryCommitment["category"],
    dueDate: assertDateOnly(row.due_date, "due_date"),
    plannedTotalEur: toSafeNumber(row.planned_total_eur, "planned_total_eur"),
    allocatedTotalEur: toSafeNumber(row.allocated_total_eur, "allocated_total_eur"),
    outstandingTotalEur: toSafeNumber(row.outstanding_total_eur, "outstanding_total_eur"),
    financialStatus: row.financial_status as UnlinkedTreasuryCommitment["financialStatus"],
    temporalCondition: row.temporal_condition as UnlinkedTreasuryCommitment["temporalCondition"],
    hasOverdueInstallment: row.has_overdue_installment,
  };
}

export async function listUnlinkedTreasuryCommitments(
  client: SupabaseClient,
  dueFrom: string | null,
  dueTo: string | null,
): Promise<UnlinkedTreasuryCommitment[]> {
  const { data, error } = await client.rpc("finance_list_unlinked_treasury_commitments", {
    p_due_from: dueFrom,
    p_due_to: dueTo,
  });
  if (error) throw new UnlinkedObligationsCommandRepositoryError("finance_list_unlinked_treasury_commitments", error);
  return ((data ?? []) as Record<string, unknown>[]).map(mapUnlinkedTreasuryCommitment);
}
