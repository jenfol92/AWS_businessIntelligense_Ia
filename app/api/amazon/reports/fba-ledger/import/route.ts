import { NextRequest, NextResponse } from "next/server";
import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { requestFbaLedgerReportJob } from "@/modules/amazon-sp-api/fbaLedgerReportService";
import { LedgerAlreadyRunningError } from "@/modules/amazon-sp-api/fbaLedgerExecutionLock";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { isAdminUser } from "@/server/auth/adminAuthorization";

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
  if (!(await isAdminUser(user))) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 403 });
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

    if (body.fromDate !== body.toDate) {
      return NextResponse.json(
        { ok: false, code: "LEDGER_DAILY_RANGE_REQUIRED", error: "El owner canónico Ledger solo admite un día por informe." },
        { status: 400 },
      );
    }
    const result = await requestFbaLedgerReportJob({
      date: body.fromDate,
      marketplaceIds: body.marketplaceIds,
      source: "manual",
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof LedgerAlreadyRunningError) {
      return NextResponse.json({
        ok: false,
        code: error.code,
        error: error.message,
        existingRunId: error.existingRunId,
        existingJobId: error.existingJobId,
      }, { status: 409 });
    }
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, error: mapped.message, code: mapped.code },
      { status: mapped.status ?? 400 },
    );
  }
}
