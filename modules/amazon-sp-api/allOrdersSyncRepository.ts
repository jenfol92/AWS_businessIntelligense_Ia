import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/server/supabase/adminClient";
import type { OrdersState } from "./allOrdersSyncPolicy";
import type { OrdersImportRow } from "./allOrdersSyncCoordinator";
async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin.rpc(name, args).abortSignal(AbortSignal.timeout(15000));
  if (error) throw new Error(error.message); return data;
}
export async function beginOrdersOperation(state: OrdersState): Promise<string> {
  return rpc("begin_amazon_orders_operation", { p_state: state });
}
export async function readOrdersOperation(jobId: string) {
  const { data, error } = await supabaseAdmin.from("amazon_orders_operations").select("*").eq("job_id", jobId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("ALL_ORDERS_OPERATION_NOT_FOUND_OR_LEGACY");
  return data as { job_id: string; state: OrdersState; status: string; lease_token: string | null; lease_expires_at: string | null };
}
export async function findOpenOrdersOperation(): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from("amazon_orders_operations").select("job_id").eq("status", "PENDING").order("created_at").limit(2);
  if (error) throw new Error(error.message);
  if (data?.length > 1) throw new Error("ALL_ORDERS_MULTIPLE_OPERATIONS");
  return data?.[0]?.job_id ?? null;
}
export async function leaseOrdersOperation(jobId: string) {
  const token = randomUUID();
  const state = await rpc("lease_amazon_orders_operation", { p_job: jobId, p_token: token }) as OrdersState | null;
  return state ? { token, state } : null;
}
export async function saveOrdersOperation(jobId: string, token: string, state: OrdersState, rows: OrdersImportRow[] = []) {
  await rpc("save_amazon_orders_operation", { p_job: jobId, p_token: token, p_state: state, p_rows: rows });
}
export async function releaseOrdersOperation(jobId: string, token: string) {
  await rpc("release_amazon_orders_operation", { p_job: jobId, p_token: token });
}
