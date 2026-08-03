import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type {
  UnlinkedInstallmentListOptions,
  UnlinkedObligationListFilters,
  UnlinkedTemplateListFilters,
} from "../types/unlinkedObligations.types";

type RawRow = Record<string, unknown>;

export class UnlinkedObligationsRepositoryError extends Error {
  constructor(operation: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`UNLINKED_OBLIGATIONS_READ_FAILED: ${operation}: ${detail}`, { cause });
    this.name = "UnlinkedObligationsRepositoryError";
  }
}

function readError(operation: string, error: unknown): never {
  throw new UnlinkedObligationsRepositoryError(operation, error);
}

function safeSearchPattern(value: string): string | null {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9À-ÖØ-öø-ÿ\s'’-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? `%${normalized}%` : null;
}

export async function findUnlinkedObligations(
  filters: UnlinkedObligationListFilters = {},
  client: SupabaseClient = createSupabaseRouteClient(),
): Promise<RawRow[]> {
  let query = client.from("finance_unlinked_obligation_balances").select("*");
  const pattern = filters.q ? safeSearchPattern(filters.q) : null;
  if (pattern) query = query.or(`concept.ilike.${pattern},counterparty_name.ilike.${pattern}`);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.financialStatus) query = query.eq("financial_status", filters.financialStatus);
  if (filters.lifecycleStatus) query = query.eq("lifecycle_status", filters.lifecycleStatus);
  if (filters.overdue !== undefined) query = query.eq("has_overdue_installment", filters.overdue);
  if (filters.dueFrom) query = query.gte("next_pending_due_date", filters.dueFrom);
  if (filters.dueTo) query = query.lte("next_pending_due_date", filters.dueTo);
  if (filters.originType) query = query.eq("origin_type", filters.originType);
  if (filters.templateId) query = query.eq("template_id", filters.templateId);
  const { data, error } = await query.order("next_pending_due_date", { ascending: true, nullsFirst: false });
  if (error) readError("list obligations", error);
  return (data ?? []) as RawRow[];
}

export async function findUnlinkedObligationById(
  id: string,
  client: SupabaseClient = createSupabaseRouteClient(),
): Promise<{ obligation: RawRow; balance: RawRow } | null> {
  const [base, balance] = await Promise.all([
    client.from("finance_unlinked_obligations").select("*").eq("id", id).maybeSingle(),
    client.from("finance_unlinked_obligation_balances").select("*").eq("obligation_id", id).maybeSingle(),
  ]);
  if (base.error) readError("read obligation", base.error);
  if (balance.error) readError("read obligation balance", balance.error);
  if (!base.data || !balance.data) return null;
  return { obligation: base.data as RawRow, balance: balance.data as RawRow };
}

export async function findUnlinkedObligationInstallments(
  obligationId: string,
  options: UnlinkedInstallmentListOptions = {},
  client: SupabaseClient = createSupabaseRouteClient(),
): Promise<RawRow[]> {
  let query = client.from("finance_unlinked_installment_balances").select("*").eq("obligation_id", obligationId);
  if (options.statuses?.length) query = query.in("installment_status", options.statuses);
  const { data, error } = await query
    .order("plan_revision", { ascending: false })
    .order("sequence_number", { ascending: true });
  if (error) readError("read obligation installments", error);
  return (data ?? []) as RawRow[];
}

export async function findUnlinkedObligationPayments(
  obligationId: string,
  client: SupabaseClient = createSupabaseRouteClient(),
): Promise<RawRow[]> {
  const { data, error } = await client.from("finance_unlinked_obligation_payments")
    .select("*").eq("obligation_id", obligationId).order("paid_at", { ascending: false });
  if (error) readError("read obligation payments", error);
  return (data ?? []) as RawRow[];
}

export async function findUnlinkedPaymentAllocations(
  installmentIds: string[],
  client: SupabaseClient = createSupabaseRouteClient(),
): Promise<RawRow[]> {
  if (installmentIds.length === 0) return [];
  const { data, error } = await client.from("finance_unlinked_obligation_payment_allocations")
    .select("*").in("installment_id", installmentIds).order("created_at", { ascending: true });
  if (error) readError("read obligation allocations", error);
  return (data ?? []) as RawRow[];
}

export async function findUnlinkedObligationTemplates(
  filters: UnlinkedTemplateListFilters = {},
  client: SupabaseClient = createSupabaseRouteClient(),
): Promise<RawRow[]> {
  let query = client.from("finance_unlinked_obligation_templates").select("*");
  const pattern = filters.q ? safeSearchPattern(filters.q) : null;
  if (pattern) query = query.or(`concept.ilike.${pattern},counterparty_name.ilike.${pattern}`);
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.status) query = query.eq("status", filters.status);
  const { data, error } = await query.order("start_date", { ascending: true });
  if (error) readError("list obligation templates", error);
  return (data ?? []) as RawRow[];
}

export async function findUnlinkedObligationTemplateById(
  id: string,
  client: SupabaseClient = createSupabaseRouteClient(),
): Promise<RawRow | null> {
  const { data, error } = await client.from("finance_unlinked_obligation_templates")
    .select("*").eq("id", id).maybeSingle();
  if (error) readError("read obligation template", error);
  return (data as RawRow | null) ?? null;
}

export async function findTemplateOccurrences(
  templateId: string,
  client: SupabaseClient = createSupabaseRouteClient(),
): Promise<RawRow[]> {
  const { data, error } = await client.from("finance_unlinked_obligation_balances")
    .select("*").eq("template_id", templateId).order("occurrence_period", { ascending: true });
  if (error) readError("read template occurrences", error);
  return (data ?? []) as RawRow[];
}
