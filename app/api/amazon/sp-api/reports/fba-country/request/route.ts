import { NextResponse } from "next/server";
import { FBA_COUNTRY_REPORT_TYPE } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { requestFbaCountryReportJob } from "@/modules/amazon-sp-api/fbaCountryReportService";

export const dynamic = "force-dynamic";

// TODO: proteger endpoint para rol admin antes de producción.

export async function POST() {
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
