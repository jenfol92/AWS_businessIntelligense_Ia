import { NextResponse } from "next/server";
import {
  getFinanceAccessErrorResponse,
  requireFinanceDetailsAccess,
} from "@/server/auth/requireFinanceAccess";
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
  let supabase;
  try {
    ({ supabase } = await requireFinanceDetailsAccess());
  } catch (error) {
    const access = getFinanceAccessErrorResponse(error);
    if (access) return NextResponse.json(access.body, { status: access.status });
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "Internal server error" }, { status: 500 });
  }

  let body: SupplierPaymentFinancePayload;
  try {
    body = (await req.json()) as SupplierPaymentFinancePayload;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalido" }, { status: 400 });
  }
  const sourceType = typeof body.sourceType === "string" ? body.sourceType.trim() : "";

  if (sourceType !== "cash_account" && sourceType !== "credit_line") {
    return NextResponse.json(
      {
        ok: false,
        error: "La financiación manual no está permitida para pagos proveedor. Usa caja/cuenta o línea de crédito.",
      },
      { status: 400 },
    );
  }
  try {
    const input = normalizeFinanceSupplierPaymentInput({
      supplierPaymentId: params.id,
      sourceType,
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

    return NextResponse.json(
      { ok: false, code: "INTERNAL_ERROR", error: "Internal server error" },
      { status: 500 },
    );
  }
}
