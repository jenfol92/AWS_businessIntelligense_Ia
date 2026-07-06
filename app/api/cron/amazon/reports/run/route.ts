import { NextRequest, NextResponse } from "next/server";

import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { runSafeAmazonReportScheduler } from "@/modules/amazon-sp-api/amazonReportSchedulerService";

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
    console.error("[amazon-report-scheduler] missing CRON_SECRET for run");
    return NextResponse.json(
      { ok: false, enabled: false, error: "CRON_SECRET no configurado." },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (authorization !== `Bearer ${cronSecret}`) {
    console.warn("[amazon-report-scheduler] unauthorized run request");
    return NextResponse.json(
      { ok: false, enabled: false, error: "No autorizado." },
      { status: 401 },
    );
  }

  if (!isSchedulerEnabled()) {
    console.info("[amazon-report-scheduler] run disabled");
    return NextResponse.json({
      ok: true,
      enabled: false,
      steps: {
        poll: { checked: 0, done: 0, stillPending: 0, failed: 0, errors: 0 },
        preview: { checked: 0, previewed: 0, skipped: 0, errors: 0 },
        commit: { checked: 0, committed: 0, skippedSuperseded: 0, errors: 0 },
        requestDue: {
          processed: 0,
          requested: 0,
          skippedLocked: 0,
          skippedExistingJob: 0,
          errors: 0,
        },
      },
      readyToCommit: [],
      skippedSuperseded: [],
      errors: [],
      skippedReason: "disabled",
    });
  }

  try {
    const summary = await runSafeAmazonReportScheduler();
    return NextResponse.json({
      ok: true,
      enabled: true,
      ...summary,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    console.error("[amazon-report-scheduler] run error", {
      error: mapped.message,
    });
    return NextResponse.json(
      { ok: false, enabled: true, code: mapped.code, error: mapped.message },
      { status: mapped.status ?? 500 },
    );
  }
}
