import { NextRequest, NextResponse } from "next/server";
import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { importFbaLedgerDailyFromSpApi } from "@/modules/amazon-sp-api/fbaForecastSpApiImportsService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type Body = {
  fromDate?: string;
  toDate?: string;
  marketplaceIds?: string[];
};

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: NextRequest) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const missing = getMissingSpApiEnvKeys();
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Faltan variables de entorno: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const body = (await request.json()) as Body;
    if (!isDate(body.fromDate) || !isDate(body.toDate)) {
      return NextResponse.json(
        { ok: false, error: "fromDate y toDate son obligatorios (YYYY-MM-DD)." },
        { status: 400 },
      );
    }

    const summary = await importFbaLedgerDailyFromSpApi({
      fromDate: body.fromDate,
      toDate: body.toDate,
      marketplaceIds: body.marketplaceIds,
    });

    if (!summary.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: summary.error ?? "Amazon no pudo generar el informe ledger.",
          summary,
        },
        { status: summary.status === "RATE_LIMITED" ? 429 : 502 },
      );
    }

    return NextResponse.json({ ok: true, summary });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, error: mapped.message, code: mapped.code },
      { status: mapped.status ?? 400 },
    );
  }
}
