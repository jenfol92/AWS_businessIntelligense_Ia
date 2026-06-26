import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = {
  params: {
    id: string;
  };
};

type MarkPaidPayload = {
  actualFxRate?: unknown;
  paymentSource?: unknown;
  paidAt?: unknown;
  bankFeeEur?: unknown;
  notes?: unknown;
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
  return Math.round(value * 10000) / 10000;
}

function calculateAmountEur(params: {
  amountOriginal: unknown;
  originalCurrency: unknown;
  actualFxRate: number;
  currentAmountEur: unknown;
}): number {
  const current = Number(params.currentAmountEur);
  const amountOriginal = Number(params.amountOriginal);
  if (!Number.isFinite(amountOriginal)) {
    return Number.isFinite(current) ? current : 0;
  }

  const currency = String(params.originalCurrency ?? "USD").trim().toUpperCase();
  if (currency === "EUR") {
    return roundCurrency(amountOriginal);
  }

  return roundCurrency(amountOriginal * params.actualFxRate);
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
  const paidAt = asRequiredString(body.paidAt);
  const paymentSource = asRequiredString(body.paymentSource);
  const bankFeeEur = asNonNegativeNumber(body.bankFeeEur);
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

  const { data: payment, error: paymentError } = await supabase
    .from("finance_supplier_payments")
    .select("id, amount_original, original_currency, amount_eur")
    .eq("id", params.id)
    .maybeSingle();

  if (paymentError) {
    return NextResponse.json({ ok: false, error: paymentError.message }, { status: 500 });
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

  const amountEur = calculateAmountEur({
    amountOriginal: payment.amount_original,
    originalCurrency,
    actualFxRate: actualFxRateResolved,
    currentAmountEur: payment.amount_eur,
  });

  const { data: updated, error: updateError } = await supabase
    .from("finance_supplier_payments")
    .update({
      actual_fx_rate: actualFxRateResolved,
      paid_at: paidAt,
      payment_source: paymentSource,
      bank_fee_eur: bankFeeEur,
      notes,
      status: "pagado",
      amount_eur: amountEur,
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
