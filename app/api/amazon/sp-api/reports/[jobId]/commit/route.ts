import { NextResponse } from "next/server";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { commitFbaCountryReportJob } from "@/modules/amazon-sp-api/fbaCountryReportService";

export const dynamic = "force-dynamic";

// TODO: proteger endpoint para rol admin antes de producción.

type RouteContext = { params: Promise<{ jobId: string }> };

export async function POST(_req: Request, context: RouteContext) {
  try {
    const { jobId } = await context.params;
    const { job, commit } = await commitFbaCountryReportJob(jobId);

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      status: job.status,
      commit,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, code: mapped.code, error: mapped.message },
      { status: mapped.status ?? 400 },
    );
  }
}
