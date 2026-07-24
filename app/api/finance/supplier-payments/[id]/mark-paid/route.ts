import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  getSupplierPaymentExecutionErrorResponse,
  markSupplierPaymentPaid,
  normalizeMarkSupplierPaymentPaidInput,
} from "@/modules/finance/services/supplierPaymentExecutionService";
import { markAndFinanceSupplierPaymentRpc } from "@/modules/finance/repositories/supplierPaymentExecutionRepository";
import type { MarkSupplierPaymentPaidPayload } from "@/modules/finance/types/supplierPaymentExecution.types";

type Params = { params: { id: string } };

export async function PATCH(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: MarkSupplierPaymentPaidPayload;
  try {
    body = (await req.json()) as MarkSupplierPaymentPaidPayload;
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "JSON inválido" },
      { status: 422 },
    );
  }

  try {
    const input = normalizeMarkSupplierPaymentPaidInput(params.id, body);
    const result = await markSupplierPaymentPaid(
      input,
      (value) => markAndFinanceSupplierPaymentRpc(value, supabase),
    );
    return NextResponse.json({ ok: true, payment: result.payment, financing: result });
  } catch (error) {
    const known = getSupplierPaymentExecutionErrorResponse(error);
    if (known) {
      return NextResponse.json(
        { ok: false, code: known.code, error: known.message },
        { status: known.status },
      );
    }

    console.error("mark supplier payment paid:", error);
    return NextResponse.json(
      { ok: false, code: "PAYMENT_EXECUTION_FAILED", error: "No se pudo registrar el pago." },
      { status: 500 },
    );
  }
}
