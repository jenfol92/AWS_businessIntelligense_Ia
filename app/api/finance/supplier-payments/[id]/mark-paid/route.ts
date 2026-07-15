import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = {
  params: {
    id: string;
  };
};

type MarkPaidPayload = {
  actualAmountOriginal?: unknown;
  actualFxRate?: unknown;
  paymentSource?: unknown;
  paidAt?: unknown;
  bankFeeEur?: unknown;
  ffFeeEur?: unknown;
  notes?: unknown;
  mode?: unknown;
};

function asPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function asNonNegativeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function asRequiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function resolveCurrency(value: unknown): string {
  return String(value ?? "USD").trim().toUpperCase();
}

export async function PATCH(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: MarkPaidPayload;
  try {
    body = (await req.json()) as MarkPaidPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON invalido" }, { status: 400 });
  }

  const actualFxRate = asPositiveNumber(body.actualFxRate);
  const actualAmountOriginal = asPositiveNumber(body.actualAmountOriginal);
  const paidAt = asRequiredString(body.paidAt);
  const paymentSource = asRequiredString(body.paymentSource);
  const bankFeeEur = asNonNegativeNumber(body.bankFeeEur);
  const ffFeeEur = asNonNegativeNumber(body.ffFeeEur);
  const mode = body.mode === "replace" ? "replace" : "add";
  const notes =
    typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  if (!paidAt) {
    return NextResponse.json(
      { ok: false, error: "paidAt es obligatorio" },
      { status: 400 },
    );
  }

  if (!paymentSource) {
    return NextResponse.json(
      { ok: false, error: "paymentSource es obligatorio" },
      { status: 400 },
    );
  }

  if (!["cash", "caja_rural", "la_caixa", "bbva"].includes(paymentSource)) {
    return NextResponse.json(
      { ok: false, error: "paymentSource debe ser cash, caja_rural, la_caixa o bbva" },
      { status: 400 },
    );
  }

  if (actualAmountOriginal == null) {
    return NextResponse.json(
      { ok: false, error: "actualAmountOriginal debe ser mayor que 0" },
      { status: 400 },
    );
  }

  const { data: payment, error: paymentError } = await supabase
    .from("finance_supplier_payments")
    .select(
      "id, original_currency, actual_amount_original, actual_amount_eur, bank_fee_eur, ff_fee_eur, payment_source_type",
    )
    .eq("id", params.id)
    .maybeSingle();

  if (paymentError) {
    return NextResponse.json({ ok: false, error: paymentError.message }, { status: 500 });
  }

  if (mode === "replace" && payment.payment_source_type != null) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No se puede corregir este pago desde la UI porque ya tiene financiacion registrada. Revisa primero los movimientos de caja/linea.",
      },
      { status: 400 },
    );
  }

  if (!payment) {
    return NextResponse.json(
      { ok: false, error: "Pago proveedor no encontrado" },
      { status: 404 },
    );
  }

  const originalCurrency = resolveCurrency(payment.original_currency);
  const actualFxRateResolved = originalCurrency === "EUR" ? 1 : actualFxRate;

  if (actualFxRateResolved == null) {
    return NextResponse.json(
      { ok: false, error: "actualFxRate debe ser mayor que 0 para pagos no EUR" },
      { status: 400 },
    );
  }

  if (
    body.bankFeeEur !== null &&
    body.bankFeeEur !== undefined &&
    body.bankFeeEur !== "" &&
    bankFeeEur == null
  ) {
    return NextResponse.json(
      { ok: false, error: "bankFeeEur debe ser mayor o igual que 0" },
      { status: 400 },
    );
  }

  if (
    body.ffFeeEur !== null &&
    body.ffFeeEur !== undefined &&
    body.ffFeeEur !== "" &&
    ffFeeEur == null
  ) {
    return NextResponse.json(
      { ok: false, error: "ffFeeEur debe ser mayor o igual que 0" },
      { status: 400 },
    );
  }

  const calculatedActualAmountEur = roundCurrency(
    actualAmountOriginal * actualFxRateResolved,
  );
  const previousActualOriginal = asNonNegativeNumber(payment.actual_amount_original) ?? 0;
  const previousActualEur = asNonNegativeNumber(payment.actual_amount_eur) ?? 0;
  const previousBankFeeEur = asNonNegativeNumber(payment.bank_fee_eur);
  const previousFfFeeEur = asNonNegativeNumber(payment.ff_fee_eur);
  const nextActualOriginal =
    mode === "replace"
      ? roundQuantity(actualAmountOriginal)
      : roundQuantity(previousActualOriginal + actualAmountOriginal);
  const nextActualEur =
    mode === "replace"
      ? calculatedActualAmountEur
      : roundCurrency(previousActualEur + calculatedActualAmountEur);
  const nextBankFeeEur =
    mode === "replace"
      ? bankFeeEur
      : bankFeeEur == null
        ? previousBankFeeEur
        : roundCurrency((previousBankFeeEur ?? 0) + bankFeeEur);
  const nextFfFeeEur =
    mode === "replace"
      ? ffFeeEur
      : ffFeeEur == null
        ? previousFfFeeEur
        : roundCurrency((previousFfFeeEur ?? 0) + ffFeeEur);

  const { data: updated, error: updateError } = await supabase
    .from("finance_supplier_payments")
    .update({
      actual_amount_original: nextActualOriginal,
      actual_amount_eur: nextActualEur,
      actual_fx_rate: actualFxRateResolved,
      paid_at: paidAt,
      payment_source: paymentSource,
      bank_fee_eur: nextBankFeeEur,
      ff_fee_eur: nextFfFeeEur,
      notes,
      status: "pagado",
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.id)
    .select("*")
    .single();

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, payment: updated });
}
