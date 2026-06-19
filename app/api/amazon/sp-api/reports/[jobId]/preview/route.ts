import { NextResponse } from "next/server";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { downloadAndPreviewFbaCountryReportJob } from "@/modules/amazon-sp-api/fbaCountryReportService";

export const dynamic = "force-dynamic";

// TODO: proteger endpoint para rol admin antes de producción.

type RouteContext = { params: Promise<{ jobId: string }> };

export async function POST(_req: Request, context: RouteContext) {
  try {
    const { jobId } = await context.params;
    const { job, preview } = await downloadAndPreviewFbaCountryReportJob(jobId);

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      processingStatus: job.processing_status,
      reportId: job.report_id,
      reportDocumentId: job.report_document_id,
      requestedAt: job.requested_at,
      downloadedAt: job.downloaded_at,
      preview,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, code: mapped.code, error: mapped.message },
      { status: mapped.status ?? 400 },
    );
  }
}
