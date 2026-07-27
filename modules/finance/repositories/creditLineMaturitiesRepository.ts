import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { CreditLineMaturitiesQuery } from "../types/creditLineMaturities.types";

export type CreditLineMaturityRawGroup = {
  id: string;
  credit_line_id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
  bank_name: string;
  line_name: string;
  line_status: string;
  movement_count: number;
  financed_order_codes: string[];
  is_legacy_opening_balance: boolean;
};

export type CreditLineLegacyGapRaw = {
  id: string;
  bank_name: string;
  line_name: string;
  used_amount: number;
  explained_remaining: number;
};

/**
 * Carga vencimientos abiertos sin horizonte de 6 meses.
 * Los filtros de fecha/status se aplican en el servicio.
 */
export async function findOpenCreditLineMaturities(
  query: CreditLineMaturitiesQuery = {},
): Promise<{
  groups: CreditLineMaturityRawGroup[];
  legacyGaps: CreditLineLegacyGapRaw[];
}> {
  const supabase = createSupabaseRouteClient();

  let groupsQuery = supabase
    .from("finance_credit_line_repayment_groups")
    .select(
      `id, credit_line_id, period_start, period_end, due_date,
       amount, paid_amount, remaining_amount, status,
       finance_credit_lines!inner(id, bank_name, line_name, status, used_amount),
       finance_credit_line_movements(
         id, movement_type, source_type, source_id
       )`,
    )
    .in("status", ["open", "partially_paid"])
    .gt("remaining_amount", 0)
    .order("due_date", { ascending: true });

  if (query.creditLineId) {
    groupsQuery = groupsQuery.eq("credit_line_id", query.creditLineId);
  }
  if (query.from) {
    groupsQuery = groupsQuery.gte("due_date", query.from);
  }
  if (query.to) {
    groupsQuery = groupsQuery.lte("due_date", query.to);
  }

  const [groupsResult, linesResult, supplierPaymentsResult] = await Promise.all([
    groupsQuery,
    supabase
      .from("finance_credit_lines")
      .select("id, bank_name, line_name, used_amount, status"),
    supabase
      .from("finance_supplier_payments")
      .select("id, orden_id, ordenes_compra(numero_orden)"),
  ]);

  if (groupsResult.error) throw new Error(groupsResult.error.message);
  if (linesResult.error) throw new Error(linesResult.error.message);
  if (supplierPaymentsResult.error) throw new Error(supplierPaymentsResult.error.message);

  const paymentOrderById = new Map<string, string>();
  for (const payment of supplierPaymentsResult.data ?? []) {
    const row = payment as Record<string, unknown>;
    const order = row["ordenes_compra"] as
      | { numero_orden?: string | null }
      | Array<{ numero_orden?: string | null }>
      | null;
    const orderObj = Array.isArray(order) ? order[0] : order;
    const code = orderObj?.numero_orden?.trim();
    if (typeof row["id"] === "string" && code) {
      paymentOrderById.set(row["id"], code);
    }
  }

  const groups: CreditLineMaturityRawGroup[] = (groupsResult.data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const lineRaw = record["finance_credit_lines"] as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | null;
    const line = Array.isArray(lineRaw) ? lineRaw[0] : lineRaw;
    const movements = (record["finance_credit_line_movements"] as Record<string, unknown>[] | null) ?? [];
    const orderCodes = new Set<string>();
    let isLegacy = false;

    for (const movement of movements) {
      if (movement["source_type"] === "legacy_opening_balance") {
        isLegacy = true;
      }
      if (
        movement["movement_type"] === "drawdown"
        && movement["source_type"] === "supplier_payment"
        && typeof movement["source_id"] === "string"
      ) {
        const code = paymentOrderById.get(movement["source_id"]);
        if (code) orderCodes.add(code);
      }
    }

    return {
      id: String(record["id"]),
      credit_line_id: String(record["credit_line_id"]),
      period_start: String(record["period_start"]),
      period_end: String(record["period_end"]),
      due_date: String(record["due_date"]),
      amount: Number(record["amount"] ?? 0),
      paid_amount: Number(record["paid_amount"] ?? 0),
      remaining_amount: Number(record["remaining_amount"] ?? 0),
      status: String(record["status"]),
      bank_name: String(line?.["bank_name"] ?? ""),
      line_name: String(line?.["line_name"] ?? ""),
      line_status: String(line?.["status"] ?? ""),
      movement_count: movements.filter((m) => m["movement_type"] === "drawdown" || m["source_type"] === "legacy_opening_balance").length,
      financed_order_codes: Array.from(orderCodes).sort(),
      is_legacy_opening_balance: isLegacy,
    };
  });

  const explainedByLine = new Map<string, number>();
  for (const group of groups) {
    explainedByLine.set(
      group.credit_line_id,
      (explainedByLine.get(group.credit_line_id) ?? 0) + group.remaining_amount,
    );
  }

  const legacyGaps: CreditLineLegacyGapRaw[] = [];
  for (const line of linesResult.data ?? []) {
    const row = line as Record<string, unknown>;
    const id = String(row["id"]);
    const used = Number(row["used_amount"] ?? 0);
    const explained = explainedByLine.get(id) ?? 0;
    const unexplained = used - explained;
    if (unexplained > 0.01) {
      legacyGaps.push({
        id,
        bank_name: String(row["bank_name"] ?? ""),
        line_name: String(row["line_name"] ?? ""),
        used_amount: used,
        explained_remaining: explained,
      });
    }
  }

  return { groups, legacyGaps };
}
