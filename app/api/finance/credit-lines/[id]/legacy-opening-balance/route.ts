import { NextResponse } from "next/server";
import { requireFinanceDetailsAccess, getFinanceAccessErrorResponse } from "@/server/auth/requireFinanceAccess";
import { normalizeCreditLineLegacyRegularizationInput, type CreditLineLegacyRegularizationPayload } from "@/modules/finance/services/creditLineLegacyRegularizationValidation";
import { createCreditLineLegacyRegularization } from "@/modules/finance/services/creditLineLedgerService";
import { CreditLineLedgerError } from "@/modules/finance/types/creditLineLedger.types";

type Params = { params: { id: string } };

function statusFor(code: string): number {
  if (code === "NOT_FOUND") return 404;
  if (code === "ADMIN_OR_ACCOUNTING_REQUIRED") return 403;
  if (code === "INVALID_AMOUNT" || code === "INVALID_DATE" || code === "INVALID_CREDIT_LINE_CONFIGURATION") return 422;
  if (["NO_LEGACY_GAP", "LEGACY_BREAKDOWN_BELOW_GAP", "LEGACY_BREAKDOWN_EXCEEDS_GAP", "EXPLAINED_PRINCIPAL_EXCEEDS_USED", "LEGACY_PERIOD_CONFLICT", "IDEMPOTENCY_PAYLOAD_MISMATCH", "CREDIT_LINE_DELETED"].includes(code)) return 409;
  return 500;
}

export async function POST(req: Request, { params }: Params) {
  let supabase;
  try {
    ({ supabase } = await requireFinanceDetailsAccess());
  } catch (error) {
    const access = getFinanceAccessErrorResponse(error);
    if (access) return NextResponse.json(access.body, { status: access.status });
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "Internal server error" }, { status: 500 });
  }
  let body: CreditLineLegacyRegularizationPayload;
  try { body = await req.json() as CreditLineLegacyRegularizationPayload; }
  catch { return NextResponse.json({ ok: false, code: "INVALID_JSON", error: "JSON invalido" }, { status: 400 }); }
  try {
    const input = normalizeCreditLineLegacyRegularizationInput(params.id, body);
    const data = await createCreditLineLegacyRegularization(input, supabase);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof CreditLineLedgerError) {
      return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: statusFor(error.code) });
    }
    return NextResponse.json({ ok: false, code: "INTERNAL_ERROR", error: "Internal server error" }, { status: 500 });
  }
}
