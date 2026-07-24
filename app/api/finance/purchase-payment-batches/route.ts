import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { createPurchasePaymentBatchRpc } from "@/modules/finance/repositories/purchasePaymentBatchRepository";
import {
  normalizePurchasePaymentBatchPayload,
  purchasePaymentBatchErrorResponse,
} from "@/modules/finance/services/purchasePaymentBatchService";
import type { CreatePurchasePaymentBatchPayload } from "@/modules/finance/types/purchasePaymentBatch.types";

export async function POST(request: Request) {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  try {
    const body = (await request.json()) as CreatePurchasePaymentBatchPayload;
    const input = normalizePurchasePaymentBatchPayload(body);
    const result = await createPurchasePaymentBatchRpc(input, supabase);
    return NextResponse.json({ ok: true, ...result });
  } catch (caught) {
    const known = purchasePaymentBatchErrorResponse(caught);
    if (known) {
      return NextResponse.json({ ok: false, code: known.code, error: known.message }, { status: known.status });
    }
    console.error("create purchase payment batch:", caught);
    return NextResponse.json({ ok: false, error: "No se pudo crear el pago vinculado." }, { status: 500 });
  }
}
