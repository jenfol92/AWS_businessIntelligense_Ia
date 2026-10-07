import { isUtcDateOnly as isDate, salesSyncHttpStatus } from "@/modules/amazon-sp-api/fbaSalesSyncPolicy";
import { resumeFbaSalesSync } from "@/modules/amazon-sp-api/fbaSalesSyncCoordinator";
import { NextRequest, NextResponse } from "next/server";
import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import {
  importFbaSalesDailyFromSpApi,
  isSupportedFbaSalesReportType,
} from "@/modules/amazon-sp-api/fbaForecastSpApiImportsService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type Body = {
  jobId?: string;
  fromDate?: string;
  toDate?: string;
  marketplaceIds?: string[];
  reportType?: string;
};

function isDateRangeOrdered(fromDate: string, toDate: string): boolean {
  return fromDate <= toDate;
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
    if (typeof body.jobId === "string") {
      const result = await resumeFbaSalesSync(body.jobId);
      return NextResponse.json(result, {status:salesSyncHttpStatus(result.status)});
    }
    if (!isDate(body.fromDate) || !isDate(body.toDate)) {
      return NextResponse.json(
        { ok: false, error: "fromDate y toDate son obligatorios (YYYY-MM-DD)." },
        { status: 400 },
      );
    }
    if (!isDateRangeOrdered(body.fromDate, body.toDate)) {
      return NextResponse.json(
        { ok: false, error: "fromDate debe ser menor o igual que toDate." },
        { status: 400 },
      );
    }
    if (
      body.reportType != null &&
      !isSupportedFbaSalesReportType(body.reportType)
    ) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "reportType no soportado para ventas FBA. Usa GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL.",
        },
        { status: 400 },
      );
    }
    const reportType = isSupportedFbaSalesReportType(body.reportType)
      ? body.reportType
      : undefined;

    const result = await importFbaSalesDailyFromSpApi({fromDate:body.fromDate,toDate:body.toDate,marketplaceIds:body.marketplaceIds,reportType});
    return NextResponse.json(result, {status:salesSyncHttpStatus(result.status)});
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, error: mapped.message, code: mapped.code },
      { status: mapped.status ?? 400 },
    );
  }
}
