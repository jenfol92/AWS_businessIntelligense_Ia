import { NextResponse } from "next/server";
import { requireUnlinkedManagementAccess } from "@/server/auth/requireFinanceAccess";
import { readUnlinkedJson, unlinkedApiErrorResponse, UnlinkedObligationsApiError } from "@/modules/finance/services/unlinkedObligationsApiErrors";
export async function POST(request: Request) {
  try {
    const { supabase } = await requireUnlinkedManagementAccess();
    const body = await readUnlinkedJson(request);
    if (Object.keys(body).some(key => key !== "name") || typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80)
      throw new UnlinkedObligationsApiError("INVALID_PAYMENT_TYPE", "Introduce un nombre de hasta 80 caracteres.");
    const { data, error } = await supabase.from("finance_payment_types").insert({ name: body.name.trim(), category: "other" }).select("id,name,category").single();
    if (error?.code === "23505") throw new UnlinkedObligationsApiError("PAYMENT_TYPE_CONFLICT", "Ya existe un tipo de pago con ese nombre.", 409);
    if (error) throw error;
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) { return unlinkedApiErrorResponse(error); }
}
