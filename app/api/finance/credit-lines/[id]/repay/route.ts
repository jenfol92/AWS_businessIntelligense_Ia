import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { createCreditLineRepayment } from "@/modules/finance/services/creditLineLedgerService";
import { CreditLineLedgerError } from "@/modules/finance/types/creditLineLedger.types";

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
  idempotencyKey?: unknown;
};

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function ledgerErrorResponse(error: CreditLineLedgerError) {
  const status = error.code === "NOT_FOUND" ? 404 : 409;
  return NextResponse.json({ ok: false, error: error.message }, { status });
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

  const creditLineId = requiredString(params.id);
  if (!creditLineId) {
    return NextResponse.json({ ok: false, error: "creditLineId es obligatorio" }, { status: 400 });
  }

  const amount = positiveNumber(body.amount);
  if (amount == null) {
    return NextResponse.json({ ok: false, error: "amount debe ser mayor que 0" }, { status: 400 });
  }

  const movementDate = body.movementDate;
  if (!isIsoDate(movementDate)) {
    return NextResponse.json(
      { ok: false, error: "movementDate debe tener formato YYYY-MM-DD" },
      { status: 400 },
    );
  }

  const cashAccountId = requiredString(body.cashAccountId);
  if (!cashAccountId) {
    return NextResponse.json({ ok: false, error: "cashAccountId es obligatorio" }, { status: 400 });
  }

  const repaymentGroupId = requiredString(body.repaymentGroupId);
  if (!repaymentGroupId) {
    return NextResponse.json(
      { ok: false, error: "repaymentGroupId es obligatorio para pagar un vencimiento de linea" },
      { status: 400 },
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
        sourceId: null,
        notes: requiredString(body.notes),
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
