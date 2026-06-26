import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  financeSupplierPayment,
  getSupplierPaymentFinanceErrorResponse,
  normalizeFinanceSupplierPaymentInput,
} from "@/modules/finance/services/supplierPaymentFinanceService";
import type { SupplierPaymentFinancePayload } from "@/modules/finance/types/supplierPaymentFinance.types";

type Params = {
  params: {
    id: string;
  };
};

export async function POST(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: SupplierPaymentFinancePayload;
  try {
    body = (await req.json()) as SupplierPaymentFinancePayload;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalido" }, { status: 400 });
  }

  try {
    const input = normalizeFinanceSupplierPaymentInput({
      supplierPaymentId: params.id,
      sourceType: body.sourceType,
      movementDate: body.movementDate,
      cashAccountId: body.cashAccountId,
      creditLineId: body.creditLineId,
      notes: body.notes,
      idempotencyKey: body.idempotencyKey,
    });

    const data = await financeSupplierPayment(input, supabase);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const controlled = getSupplierPaymentFinanceErrorResponse(error);
    if (controlled) {
      return NextResponse.json(
        { ok: false, error: controlled.message },
        { status: controlled.status },
      );
    }

    const message = error instanceof Error ? error.message : "Error inesperado";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
