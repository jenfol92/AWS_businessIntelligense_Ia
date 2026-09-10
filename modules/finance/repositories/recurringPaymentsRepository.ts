import type { SupabaseClient } from "@supabase/supabase-js";
import { UnlinkedObligationsCommandRepositoryError } from "./unlinkedObligationsCommandsRepository";

export async function recurringPaymentOptions(client: SupabaseClient) {
  const [types, accounts] = await Promise.all([
    client.from("finance_payment_types").select("id,name,category").order("name"),
    client.from("finance_cash_accounts").select("id,name,balance,currency").eq("currency", "EUR").order("name"),
  ]);
  if (types.error) throw new UnlinkedObligationsCommandRepositoryError("payment types", types.error);
  if (accounts.error) throw new UnlinkedObligationsCommandRepositoryError("accounts", accounts.error);
  return { types: types.data, accounts: accounts.data };
}

export async function executeRecurringPayment(client: SupabaseClient, payload: Record<string, unknown>, paying: boolean) {
  const { data, error } = await client.rpc(paying ? "finance_pay_unlinked_installment" : "finance_create_recurring_payment", { p_payload: payload });
  if (error) throw new UnlinkedObligationsCommandRepositoryError("recurring payment", error);
  return data;
}

export async function recurringOperationStatus(client: SupabaseClient, operationId: string, paying: boolean) {
  const { data, error } = await client.rpc("finance_recurring_operation_status", { p_operation_id: operationId, p_paying: paying });
  if (error) throw new UnlinkedObligationsCommandRepositoryError("operation status", error);
  return data;
}

export async function readRecurringCalendar(client: SupabaseClient, from: string, to: string) {
  const { data, error } = await client.rpc("finance_recurring_payment_calendar", { p_from: from, p_to: to });
  if (error) {
    // Only an absent local migration gets a visible compatibility warning. Other errors fail the read.
    if (error.code === "PGRST202" || error.code === "42883") return { rows: [], warning: "Pagos recurrentes no disponibles: falta aplicar la migración financiera. El resumen no incluye estas obligaciones." };
    throw new UnlinkedObligationsCommandRepositoryError("recurring calendar", error);
  }
  return { rows: (data ?? []) as Record<string, unknown>[], warning: null };
}
