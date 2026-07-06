import { NextRequest, NextResponse } from "next/server";

import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { requestDueAmazonReportSchedules } from "@/modules/amazon-sp-api/amazonReportSchedulerService";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  return authorization === `Bearer ${cronSecret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }

  try {
    console.warn(
      "[amazon-report-scheduler] legacy route /api/cron/amazon-sp-api/reports only requests reports; use /api/cron/amazon/reports/run for poll/preview/commit/request flow.",
    );
    const summary = await requestDueAmazonReportSchedules();
    return NextResponse.json({
      ok: true,
      legacy: true,
      warning:
        "Ruta legacy: solo requestea informes. Usar /api/cron/amazon/reports/run como cron principal.",
      totalDue: summary.processed,
      requested: summary.requested,
      skipped: summary.skippedLocked + summary.skippedExistingJob,
      skippedLocked: summary.skippedLocked,
      skippedExistingJob: summary.skippedExistingJob,
      errors: summary.errors,
      results: summary.results,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, code: mapped.code, error: mapped.message },
      { status: mapped.status ?? 400 },
    );
  }
}
