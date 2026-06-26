/**
 * Módulo  : finance
 * Archivo : app/api/finance/supplier-payments/backfill/route.ts
 * Qué hace: POST — backfill manual de pagos proveedor para órdenes confirmadas sin pagos.
 *           Devuelve found/synced/failed/errors y totales post-backfill.
 * No hace : lógica de negocio (delega en el service).
 * No toca : finance_credit_line_movements (FASE 2).
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { backfillMissingSupplierPayments } from "@/modules/finance/services/syncSupplierPaymentsForOrder";

function supabaseHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").host;
  } catch {
    return "invalid_supabase_url";
  }
}

function fmtError(error: {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}): Record<string, string | null> {
  return {
    message: error.message,
    details: error.details ?? null,
    hint: error.hint ?? null,
    code: error.code ?? null,
  };
}

export async function POST() {
  const host = supabaseHost();
  console.log("[finance/backfill] route hit", { supabaseHost: host });

  const supabase = createSupabaseRouteClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError) {
    const isSessionMissing = authError.message?.includes("session missing") || authError.message?.includes("Auth session");
    return NextResponse.json(
      { ok: false, stage: "auth", error: fmtError(authError) },
      { status: isSessionMissing ? 401 : 500 },
    );
  }
  if (!authData.user) {
    return NextResponse.json(
      { ok: false, stage: "auth", error: "No autorizado — sin sesión Supabase activa." },
      { status: 401 },
    );
  }
  console.log("[finance/backfill] user", { id: authData.user.id, email: authData.user.email });

  const result = await backfillMissingSupplierPayments();

  const [totalRes, dep30Res, bal70Res] = await Promise.all([
    supabase.from("finance_supplier_payments").select("*", { count: "exact", head: true }),
    supabase.from("finance_supplier_payments").select("*", { count: "exact", head: true }).eq("payment_type", "DEPOSITO_30"),
    supabase.from("finance_supplier_payments").select("*", { count: "exact", head: true }).eq("payment_type", "BALANCE_70"),
  ]);

  for (const [stage, res] of [["post_total", totalRes], ["post_deposito_30", dep30Res], ["post_balance_70", bal70Res]] as const) {
    if (res.error) {
      return NextResponse.json(
        { ok: false, stage, result, error: fmtError(res.error) },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    supabaseHost: host,
    user: { id: authData.user.id, email: authData.user.email },
    found: result.found,
    synced: result.synced,
    failed: result.failed,
    failedOrderIds: result.failedOrderIds,
    errors: result.errors,
    totals: {
      finance_supplier_payments: totalRes.count ?? 0,
      DEPOSITO_30: dep30Res.count ?? 0,
      BALANCE_70: bal70Res.count ?? 0,
    },
  });
}
