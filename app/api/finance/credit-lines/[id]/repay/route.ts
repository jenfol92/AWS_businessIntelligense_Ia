import { NextResponse } from "next/server";
import {
  getFinanceAccessErrorResponse,
  requireFinanceDetailsAccess,
} from "@/server/auth/requireFinanceAccess";
import { createCreditLineRepaymentV2 } from "@/modules/finance/services/creditLineLedgerService";
import { CreditLineLedgerError } from "@/modules/finance/types/creditLineLedger.types";
import {
  normalizeCreditLineRepaymentV2Input,
  type CreditLineRepaymentV2Payload,
} from "@/modules/finance/services/creditLineRepaymentValidation";

type Params = {
  params: {
    id: string;
  };
};

function ledgerErrorResponse(error: CreditLineLedgerError) {
  const status =
    error.code === "NOT_FOUND"
      ? 404
      : error.code === "UNAUTHORIZED"
        ? 401
        : error.code === "ADMIN_OR_ACCOUNTING_REQUIRED"
          ? 403
        : error.code === "INTERNAL_ERROR"
          ? 500
        : error.code === "INVALID_AMOUNT"
          || error.code === "INVALID_DATE"
          || error.code === "INVALID_CURRENCY"
          || error.code === "MANUAL_DUE_DATE_REQUIRED"
          || error.code === "MANUAL_DUE_DATE_NOT_ALLOWED"
          || error.code === "MISSING_REPAYMENT_GROUP"
          || error.code === "MISSING_CASH_ACCOUNT"
          || error.code === "DIRECT_DML_FORBIDDEN"
          ? 422
          : error.code === "REPAYMENT_DATE_OUT_OF_SEQUENCE"
            ? 409
          : error.code === "IDEMPOTENCY_PAYLOAD_MISMATCH"
            ? 409
          : 409;
  return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
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

  let body: CreditLineRepaymentV2Payload;
  try {
    body = (await req.json()) as CreditLineRepaymentV2Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalido" }, { status: 400 });
  }

  try {
    const input = normalizeCreditLineRepaymentV2Input(params.id, body);
    const data = await createCreditLineRepaymentV2(input, supabase);

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof CreditLineLedgerError) {
      return ledgerErrorResponse(error);
    }

    return NextResponse.json(
      { ok: false, code: "INTERNAL_ERROR", error: "Internal server error" },
      { status: 500 },
    );
  }
}
