import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CreateUnlinkedObligationInput,
  CreateUnlinkedObligationTemplateInput,
  ReplaceUnlinkedInstallmentPlanInput,
  UpdateUnlinkedObligationMetadataInput,
  UpdateUnlinkedObligationTemplateInput,
} from "../types/unlinkedObligations.types";

export class UnlinkedObligationsCommandRepositoryError extends Error {
  readonly code: string | null;
  readonly details: string | null;
  readonly hint: string | null;

  constructor(operation: string, error: { message?: string; code?: string; details?: string; hint?: string }) {
    super(error.message || `Unlinked obligation RPC failed: ${operation}`);
    this.name = "UnlinkedObligationsCommandRepositoryError";
    this.code = error.code ?? null;
    this.details = error.details ?? null;
    this.hint = error.hint ?? null;
  }
}

async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new UnlinkedObligationsCommandRepositoryError(name, error);
  return data;
}

export function createUnlinkedObligation(client: SupabaseClient, payload: CreateUnlinkedObligationInput) {
  return rpc(client, "finance_create_unlinked_obligation", { p_payload: payload });
}

export function updatePendingUnlinkedObligation(client: SupabaseClient, id: string, payload: UpdateUnlinkedObligationMetadataInput) {
  return rpc(client, "finance_update_pending_unlinked_obligation", { p_obligation_id: id, p_payload: payload });
}

export function replaceUnpaidInstallmentPlan(client: SupabaseClient, id: string, payload: ReplaceUnlinkedInstallmentPlanInput) {
  return rpc(client, "finance_replace_unpaid_installment_plan", { p_obligation_id: id, p_payload: payload });
}

export function cancelUnlinkedObligation(client: SupabaseClient, id: string, reason: string) {
  return rpc(client, "finance_cancel_unlinked_obligation", { p_obligation_id: id, p_reason: reason });
}

export function createUnlinkedObligationTemplate(client: SupabaseClient, payload: CreateUnlinkedObligationTemplateInput) {
  return rpc(client, "finance_create_unlinked_obligation_template", { p_payload: payload });
}

export function updateUnlinkedObligationTemplate(client: SupabaseClient, id: string, payload: UpdateUnlinkedObligationTemplateInput) {
  return rpc(client, "finance_update_unlinked_obligation_template", { p_template_id: id, p_payload: payload });
}

export function generateUnlinkedObligationOccurrences(client: SupabaseClient, id: string, throughDate: string) {
  return rpc(client, "finance_generate_unlinked_obligation_occurrences", { p_template_id: id, p_through_date: throughDate });
}
