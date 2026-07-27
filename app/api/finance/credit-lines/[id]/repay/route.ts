import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { createCreditLineRepayment } from "@/modules/finance/services/creditLineLedgerService";
import { CreditLineLedgerError } from "@/modules/finance/types/creditLineLedger.types";
import {
  isFinitePositiveMoney,
  isRealIsoDate,
  isUuid,
  roundMoney,
} from "@/modules/finance/utils/financeInputValidation";

type Params = {
  params: {
    id: string;
  };
};

type RepayPayload = {
  amount?: unknown;
  movementDate?: unknown;
  cashAccountId?: unknown;
  repaymentGroupId?: unknown;
  notes?: unknown;
  bankReference?: unknown;
  idempotencyKey?: unknown;
  sourceId?: unknown;
};

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function ledgerErrorResponse(error: CreditLineLedgerError) {
  const status =
    error.code === "NOT_FOUND"
      ? 404
      : error.code === "UNAUTHORIZED"
        ? 401
        : error.code === "INVALID_AMOUNT"
          || error.code === "INVALID_DATE"
          || error.code === "INVALID_CURRENCY"
          || error.code === "MANUAL_DUE_DATE_REQUIRED"
          || error.code === "MISSING_REPAYMENT_GROUP"
          || error.code === "MISSING_CASH_ACCOUNT"
          || error.code === "DIRECT_DML_FORBIDDEN"
          ? 422
          : 409;
  return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status });
}

export async function POST(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: RepayPayload;
  try {
    body = (await req.json()) as RepayPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalido" }, { status: 400 });
  }

  if (!isUuid(params.id)) {
    return NextResponse.json(
      { ok: false, error: "creditLineId debe ser un UUID valido", code: "INVALID_UUID" },
      { status: 422 },
    );
  }
  const creditLineId = params.id.trim();

  const amountRaw = typeof body.amount === "number" ? body.amount : Number(body.amount);
  if (!isFinitePositiveMoney(amountRaw)) {
    return NextResponse.json(
      { ok: false, error: "amount debe ser un numero finito mayor que 0", code: "INVALID_AMOUNT" },
      { status: 422 },
    );
  }
  const amount = roundMoney(amountRaw);

  if (!isRealIsoDate(body.movementDate)) {
    return NextResponse.json(
      { ok: false, error: "movementDate no es una fecha valida", code: "INVALID_DATE" },
      { status: 422 },
    );
  }
  const movementDate = body.movementDate;

  if (!isUuid(body.cashAccountId)) {
    return NextResponse.json(
      { ok: false, error: "cashAccountId debe ser un UUID valido", code: "INVALID_UUID" },
      { status: 422 },
    );
  }
  const cashAccountId = String(body.cashAccountId).trim();

  if (!isUuid(body.repaymentGroupId)) {
    return NextResponse.json(
      {
        ok: false,
        error: "repaymentGroupId debe ser un UUID valido",
        code: "INVALID_UUID",
      },
      { status: 422 },
    );
  }
  const repaymentGroupId = String(body.repaymentGroupId).trim();

  if (body.sourceId != null && body.sourceId !== "" && !isUuid(body.sourceId)) {
    return NextResponse.json(
      { ok: false, error: "sourceId debe ser un UUID valido", code: "INVALID_UUID" },
      { status: 422 },
    );
  }

  try {
    const data = await createCreditLineRepayment(
      {
        creditLineId,
        amount,
        movementDate,
        cashAccountId,
        repaymentGroupId,
        sourceType: "repayment_group",
        sourceId: isUuid(body.sourceId) ? String(body.sourceId).trim() : null,
        notes: requiredString(body.notes),
        bankReference: requiredString(body.bankReference),
        idempotencyKey: requiredString(body.idempotencyKey),
      },
      supabase,
    );

    return NextResponse.json({ ok: true, data });
  } catch (error) {
    if (error instanceof CreditLineLedgerError) {
      return ledgerErrorResponse(error);
    }

    const message = error instanceof Error ? error.message : "Error inesperado";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
