import { NextRequest, NextResponse } from "next/server";

import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { requestDueAmazonReportSchedules } from "@/modules/amazon-sp-api/amazonReportSchedulerService";

export const dynamic = "force-dynamic";

function getCronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}

function isSchedulerEnabled(): boolean {
  return process.env.AMAZON_REPORT_SCHEDULER_ENABLED?.trim().toLowerCase() !== "false";
}

export async function GET(request: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    console.error("[amazon-report-scheduler] missing CRON_SECRET");
    return NextResponse.json(
      { ok: false, enabled: false, error: "CRON_SECRET no configurado." },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (authorization !== `Bearer ${cronSecret}`) {
    console.warn("[amazon-report-scheduler] unauthorized cron request");
    return NextResponse.json(
      { ok: false, enabled: false, error: "No autorizado." },
      { status: 401 },
    );
  }

  if (!isSchedulerEnabled()) {
    console.info("[amazon-report-scheduler] scheduler disabled");
    return NextResponse.json({
      ok: true,
      enabled: false,
      processed: 0,
      requested: 0,
      skippedLocked: 0,
      skippedExistingJob: 0,
      errors: 0,
      results: [],
      skipped: "disabled",
    });
  }

  try {
    const summary = await requestDueAmazonReportSchedules();
    return NextResponse.json({
      ok: true,
      enabled: true,
      ...summary,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    console.error("[amazon-report-scheduler] cron request-due error", {
      error: mapped.message,
    });
    return NextResponse.json(
      { ok: false, enabled: true, code: mapped.code, error: mapped.message },
      { status: mapped.status ?? 500 },
    );
  }
}
