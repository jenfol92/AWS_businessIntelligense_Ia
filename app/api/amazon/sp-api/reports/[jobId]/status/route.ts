import { NextResponse } from "next/server";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { refreshFbaCountryReportJobStatus } from "@/modules/amazon-sp-api/fbaCountryReportService";

export const dynamic = "force-dynamic";

// TODO: proteger endpoint para rol admin antes de producción.

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(_req: Request, context: RouteContext) {
  try {
    const { jobId } = await context.params;
    const result = await refreshFbaCountryReportJobStatus(jobId);

    return NextResponse.json({
      ok: true,
      jobId: result.job.id,
      status: result.job.status,
      processingStatus: result.processingStatus,
      reportId: result.job.report_id,
      reportDocumentId: result.reportDocumentId,
      requestedAt: result.job.requested_at,
      completedAt: result.job.completed_at,
      downloadedAt: result.job.downloaded_at,
      errorMessage: result.job.error_message,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, code: mapped.code, error: mapped.message },
      { status: mapped.status ?? 400 },
    );
  }
}
