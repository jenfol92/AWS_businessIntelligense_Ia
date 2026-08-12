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
  credit_limit: number;
  line_status: string;
  movement_count: number;
  financed_order_codes: string[];
  is_legacy_opening_balance: boolean;
  expected_interest_eur: number | null;
  expected_fees_eur: number | null;
};

export type CreditLineLegacyGapRaw = {
  id: string;
  bank_name: string;
  line_name: string;
  used_amount: number;
  credit_limit: number;
  explained_remaining: number;
  repayment_mode: "periodic_release" | "manual_due_dates";
  cycle_days: number | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * DISPLAY_QUERY: open groups with optional visual filters.
 * INTEGRITY_QUERY: explained remaining uses ALL open/partial groups (no date filter).
 */
export async function findOpenCreditLineMaturities(
  query: CreditLineMaturitiesQuery = {},
): Promise<{
  groups: CreditLineMaturityRawGroup[];
  legacyGaps: CreditLineLegacyGapRaw[];
}> {
  const supabase = createSupabaseRouteClient();

  let displayQuery = supabase
    .from("finance_credit_line_repayment_groups")
    .select(
      `id, credit_line_id, period_start, period_end, due_date,
       amount, paid_amount, remaining_amount, status,
       finance_credit_lines!inner(id, bank_name, line_name, status, credit_limit, used_amount),
       finance_credit_line_movements(
         id, movement_type, source_type, source_id
       )`,
    )
    .in("status", ["open", "partially_paid"])
    .gt("remaining_amount", 0)
    .order("due_date", { ascending: true });

  if (query.creditLineId) {
    displayQuery = displayQuery.eq("credit_line_id", query.creditLineId);
  }
  if (query.from) {
    displayQuery = displayQuery.gte("due_date", query.from);
  }
  if (query.to) {
    displayQuery = displayQuery.lte("due_date", query.to);
  }

  let integrityQuery = supabase
    .from("finance_credit_line_repayment_groups")
    .select("credit_line_id, remaining_amount, status")
    .in("status", ["open", "partially_paid"])
    .gt("remaining_amount", 0);

  if (query.creditLineId) {
    integrityQuery = integrityQuery.eq("credit_line_id", query.creditLineId);
  }

  let linesQuery = supabase
    .from("finance_credit_lines")
    .select("id, bank_name, line_name, credit_limit, used_amount, status, repayment_mode, cycle_days");
  if (query.creditLineId) {
    linesQuery = linesQuery.eq("id", query.creditLineId);
  }

  const [groupsResult, integrityResult, linesResult] = await Promise.all([
    displayQuery,
    integrityQuery,
    linesQuery,
  ]);

  if (groupsResult.error) throw new Error(groupsResult.error.message);
  if (integrityResult.error) throw new Error(integrityResult.error.message);
  if (linesResult.error) throw new Error(linesResult.error.message);

  const groupIds = (groupsResult.data ?? []).map((row) => String((row as Record<string, unknown>)["id"]));
  const legacyCostsByGroup = new Map<string, { interest: number | null; fees: number | null }>();
  if (groupIds.length > 0) {
    const { data, error } = await supabase
      .from("finance_credit_line_legacy_regularization_items")
      .select("repayment_group_id, expected_interest_eur, expected_fees_eur")
      .in("repayment_group_id", groupIds);
    if (error) throw new Error(error.message);
    for (const item of data ?? []) {
      const record = item as Record<string, unknown>;
      legacyCostsByGroup.set(String(record["repayment_group_id"]), {
        interest: record["expected_interest_eur"] == null ? null : Number(record["expected_interest_eur"]),
        fees: record["expected_fees_eur"] == null ? null : Number(record["expected_fees_eur"]),
      });
    }
  }

  const supplierPaymentIds = new Set<string>();
  const batchIds = new Set<string>();
  for (const row of groupsResult.data ?? []) {
    const movements =
      ((row as Record<string, unknown>)["finance_credit_line_movements"] as
        | Record<string, unknown>[]
        | null) ?? [];
    for (const movement of movements) {
      if (
        movement["movement_type"] === "drawdown"
        && typeof movement["source_id"] === "string"
      ) {
        if (movement["source_type"] === "supplier_payment") {
          supplierPaymentIds.add(movement["source_id"]);
        }
        if (movement["source_type"] === "purchase_payment_batch") {
          batchIds.add(movement["source_id"]);
        }
      }
    }
  }

  const paymentOrderById = new Map<string, string>();
  if (supplierPaymentIds.size > 0) {
    const { data, error } = await supabase
      .from("finance_supplier_payments")
      .select("id, ordenes_compra(numero_orden)")
      .in("id", Array.from(supplierPaymentIds));
    if (error) throw new Error(error.message);
    for (const payment of data ?? []) {
      const record = payment as Record<string, unknown>;
      const order = firstRelation(
        record["ordenes_compra"] as
          | { numero_orden?: string | null }
          | Array<{ numero_orden?: string | null }>
          | null,
      );
      const code = order?.numero_orden?.trim();
      if (typeof record["id"] === "string" && code) {
        paymentOrderById.set(record["id"], code);
      }
    }
  }

  const batchOrderCodes = new Map<string, string[]>();
  if (batchIds.size > 0) {
    const { data, error } = await supabase
      .from("finance_purchase_payment_allocations")
      .select(
        `batch_id,
         finance_supplier_payments!inner(
           id,
           ordenes_compra(numero_orden)
         )`,
      )
      .in("batch_id", Array.from(batchIds));
    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const record = row as Record<string, unknown>;
      const batchId = String(record["batch_id"]);
      const payment = firstRelation(
        record["finance_supplier_payments"] as
          | Record<string, unknown>
          | Record<string, unknown>[]
          | null,
      );
      const order = firstRelation(
        payment?.["ordenes_compra"] as
          | { numero_orden?: string | null }
          | Array<{ numero_orden?: string | null }>
          | null,
      );
      const code = order?.numero_orden?.trim();
      if (!code) continue;
      const list = batchOrderCodes.get(batchId) ?? [];
      if (!list.includes(code)) list.push(code);
      batchOrderCodes.set(batchId, list);
    }
  }

  const groups: CreditLineMaturityRawGroup[] = (groupsResult.data ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const line = firstRelation(
      record["finance_credit_lines"] as
        | Record<string, unknown>
        | Record<string, unknown>[]
        | null,
    );
    const movements =
      (record["finance_credit_line_movements"] as Record<string, unknown>[] | null) ?? [];
    const orderCodes = new Set<string>();
    let isLegacy = false;
    const legacyCosts = legacyCostsByGroup.get(String(record["id"]));

    for (const movement of movements) {
      if (movement["source_type"] === "legacy_opening_balance") {
        isLegacy = true;
      }
      if (movement["movement_type"] !== "drawdown" || typeof movement["source_id"] !== "string") {
        continue;
      }
      if (movement["source_type"] === "supplier_payment") {
        const code = paymentOrderById.get(movement["source_id"]);
        if (code) orderCodes.add(code);
      }
      if (movement["source_type"] === "purchase_payment_batch") {
        for (const code of batchOrderCodes.get(movement["source_id"]) ?? []) {
          orderCodes.add(code);
        }
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
      credit_limit: Number(line?.["credit_limit"] ?? 0),
      line_status: String(line?.["status"] ?? ""),
      movement_count: movements.filter(
        (m) =>
          m["movement_type"] === "drawdown"
          || m["source_type"] === "legacy_opening_balance",
      ).length,
      financed_order_codes: Array.from(orderCodes).sort(),
      is_legacy_opening_balance: isLegacy,
      expected_interest_eur: legacyCosts?.interest ?? null,
      expected_fees_eur: legacyCosts?.fees ?? null,
    };
  });

  const explainedByLine = new Map<string, number>();
  for (const row of integrityResult.data ?? []) {
    const record = row as Record<string, unknown>;
    const lineId = String(record["credit_line_id"]);
    explainedByLine.set(
      lineId,
      (explainedByLine.get(lineId) ?? 0) + Number(record["remaining_amount"] ?? 0),
    );
  }

  const legacyGaps: CreditLineLegacyGapRaw[] = [];
  for (const line of linesResult.data ?? []) {
    const row = line as Record<string, unknown>;
    const id = String(row["id"]);
    const used = Number(row["used_amount"] ?? 0);
    const explained = explainedByLine.get(id) ?? 0;
    if (used - explained > 0.01) {
      legacyGaps.push({
        id,
        bank_name: String(row["bank_name"] ?? ""),
        line_name: String(row["line_name"] ?? ""),
        used_amount: used,
        credit_limit: Number(row["credit_limit"] ?? 0),
        explained_remaining: explained,
        repayment_mode: String(row["repayment_mode"]) as "periodic_release" | "manual_due_dates",
        cycle_days: row["cycle_days"] == null ? null : Number(row["cycle_days"]),
      });
    }
  }

  return { groups, legacyGaps };
}
