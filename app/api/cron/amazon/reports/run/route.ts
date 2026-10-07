import { recoverPendingLedgerSync } from "@/modules/amazon-sp-api/fbaLedgerSyncRecovery";
import { resumeDueFbaSalesSync } from "@/modules/amazon-sp-api/fbaSalesSyncCoordinator";
import { recoverPendingFbmSync } from "@/modules/amazon-sp-api/fbmSyncRecovery";
import { NextRequest, NextResponse } from "next/server";

import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { runSafeAmazonReportScheduler } from "@/modules/amazon-sp-api/amazonReportSchedulerService";

export const dynamic = "force-dynamic";

function getCronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}

function isSchedulerEnabled(): boolean {
  return process.env.AMAZON_REPORT_SCHEDULER_ENABLED === "true";
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

  // FBM recovery is independently enabled; the legacy reports switch must not strand a manual FBM job.
  const ledger = await recoverPendingLedgerSync().catch(() => ({ status: "RECOVERY_ERROR" }));
  const fbm = await recoverPendingFbmSync().catch(() => ({ status: "RECOVERY_ERROR" }));
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
      fbm,
      ledger,
    });
  }

  try {
    const summary = await runSafeAmazonReportScheduler();
    const fbaSales = await resumeDueFbaSalesSync().catch((error: unknown) => ({
      ok: false, status: "FAILED", error: mapGenericError(error).message,
    }));
    const fbaSalesFailed = fbaSales?.status === "FAILED" || fbaSales?.status === "FATAL";
    return NextResponse.json({
      ok: !fbaSalesFailed,
      enabled: true,
      ...summary,
      fbaSales,
      fbm,
      ledger,
    }, {status: fbaSalesFailed ? 502 : 200});
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
