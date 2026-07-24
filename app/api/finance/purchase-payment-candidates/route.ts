import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { findPurchasePaymentCandidates } from "@/modules/finance/repositories/purchasePaymentBatchRepository";

export async function GET(request: Request) {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  try {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const [candidates, cash, credit] = await Promise.all([
      findPurchasePaymentCandidates(query, supabase),
      supabase.from("finance_cash_accounts").select("id, name, balance, currency").order("name"),
      supabase.from("finance_credit_lines").select("*").in("status", ["activa", "activo", "active"]).order("priority"),
    ]);
    if (cash.error) throw cash.error;
    if (credit.error) throw credit.error;
    return NextResponse.json({
      ok: true,
      candidates,
      cashAccounts: (cash.data ?? []).map((row) => ({
        id: row.id, name: row.name, balance: Number(row.balance), currency: row.currency,
      })),
      creditLines: (credit.data ?? []).map((row) => ({
        id: row.id,
        bankName: row.bank_name,
        lineName: row.line_name,
        creditLimit: Number(row.credit_limit),
        availableAmount: Number(row.available_amount),
        usedAmount: Number(row.used_amount),
        cycleDays: row.cycle_days,
        maturityDate: row.maturity_date,
        repaymentMode: row.repayment_mode,
        priority: row.priority,
        status: row.status,
        notes: row.notes,
      })),
    });
  } catch (caught) {
    console.error("purchase payment candidates:", caught);
    return NextResponse.json({ ok: false, error: "No se pudieron cargar las obligaciones." }, { status: 500 });
  }
}
