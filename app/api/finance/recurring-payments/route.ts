import { NextResponse } from "next/server";
import { requireUnlinkedManagementAccess } from "@/server/auth/requireFinanceAccess";
import { recurringPaymentOptions, executeRecurringPayment, recurringOperationStatus } from "@/modules/finance/repositories/recurringPaymentsRepository";
import { validateUuid } from "@/modules/finance/services/unlinkedObligationsValidation";
import { validateRecurringPayment } from "@/modules/finance/services/recurringPaymentValidation";
import { readUnlinkedJson, unlinkedApiErrorResponse, mapUnlinkedApiError, UnlinkedObligationsApiError } from "@/modules/finance/services/unlinkedObligationsApiErrors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const { supabase, user } = await requireUnlinkedManagementAccess();
    const query = new URL(request.url).searchParams;
    if (query.has("operationId")) {
      if (!["pay", "create"].includes(query.get("kind") ?? "")) throw new UnlinkedObligationsApiError("INVALID_OPERATION", "Tipo de operación no válido.");
      const data = await recurringOperationStatus(supabase, validateUuid(query.get("operationId")), query.get("kind") === "pay");
      return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
    }
    const operationScope = `${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host}:${user.id}`;
    return NextResponse.json({ ok: true, operationScope, ...await recurringPaymentOptions(supabase) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return unlinkedApiErrorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const { supabase } = await requireUnlinkedManagementAccess();
    const paying = new URL(request.url).searchParams.get("action") === "pay";
    const payload = validateRecurringPayment(await readUnlinkedJson(request), paying);
    const data = await executeRecurringPayment(supabase, payload, paying);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const mapped = mapUnlinkedApiError(error);
    const definitiveRejection = [401,403,422].includes(mapped.status)
      || (mapped.status === 409 && mapped.code !== "IDEMPOTENCY_CONFLICT");
    return NextResponse.json({ ok: false, code: mapped.code, error: mapped.error, definitiveRejection }, { status: mapped.status });
  }
}
