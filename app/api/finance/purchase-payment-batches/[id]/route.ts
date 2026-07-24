import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { findPurchasePaymentBatch } from "@/modules/finance/repositories/purchasePaymentBatchRepository";

type Params = { params: { id: string } };

export async function GET(_request: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  try {
    const detail = await findPurchasePaymentBatch(params.id, supabase);
    if (!detail) return NextResponse.json({ ok: false, error: "Pago no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true, ...detail });
  } catch (caught) {
    console.error("purchase payment batch detail:", caught);
    return NextResponse.json({ ok: false, error: "No se pudo cargar el pago vinculado." }, { status: 500 });
  }
}
