import { NextResponse } from "next/server";
import { FBA_COUNTRY_REPORT_TYPE } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { requestFbaCountryReportJob } from "@/modules/amazon-sp-api/fbaCountryReportService";

export const dynamic = "force-dynamic";

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, error: "Endpoint SP-API no disponible en producción sin protección admin." },
      { status: 404 },
    );
  }

  try {
    const { job, reportId } = await requestFbaCountryReportJob();

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      reportId,
      reportType: FBA_COUNTRY_REPORT_TYPE,
      status: job.status,
      marketplaceIds: job.marketplace_ids,
      requestedAt: job.requested_at,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, code: mapped.code, error: mapped.message },
      { status: mapped.status ?? 400 },
    );
  }
}
