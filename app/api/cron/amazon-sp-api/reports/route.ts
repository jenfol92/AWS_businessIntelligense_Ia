import { NextRequest, NextResponse } from "next/server";
import { FBA_COUNTRY_REPORT_TYPE } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { requestFbaCountryReportJob } from "@/modules/amazon-sp-api/fbaCountryReportService";
import {
  finishAmazonReportSyncRunError,
  finishAmazonReportSyncRunSuccess,
  listDueAmazonReportSchedules,
  startAmazonReportSyncRun,
} from "@/modules/amazon-sp-api/amazonReportSchedulerService";
import type { AmazonReportSchedule } from "@/modules/amazon-sp-api/amazonReportSchedulerService";

export const dynamic = "force-dynamic";

const SUPPORTED_REPORT_TYPES = new Set([
  "FBA_COUNTRY",
  FBA_COUNTRY_REPORT_TYPE,
]);

type CronScheduleResult = {
  scheduleId: string;
  reportType: string;
  marketplaceCountry: string | null;
  marketplaceId: string | null;
  status: "SUCCESS" | "ERROR" | "SKIPPED";
  reason?: "LOCKED" | "UNSUPPORTED_REPORT_TYPE";
  runId?: string;
  amazonReportJobId?: string;
  reportId?: string;
  error?: string;
};

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  return authorization === `Bearer ${cronSecret}`;
}

function getScheduleMarketplaceIds(schedule: AmazonReportSchedule): string[] | null {
  const marketplaceId = schedule.marketplace_id?.trim();
  return marketplaceId ? [marketplaceId] : null;
}

async function processSchedule(
  schedule: AmazonReportSchedule,
): Promise<CronScheduleResult> {
  const base = {
    scheduleId: schedule.id,
    reportType: schedule.report_type,
    marketplaceCountry: schedule.marketplace_country,
    marketplaceId: schedule.marketplace_id,
  };

  if (!SUPPORTED_REPORT_TYPES.has(schedule.report_type)) {
    return {
      ...base,
      status: "SKIPPED",
      reason: "UNSUPPORTED_REPORT_TYPE",
    };
  }

  const started = await startAmazonReportSyncRun({
    scheduleId: schedule.id,
    reportType: schedule.report_type,
    marketplaceCountry: schedule.marketplace_country,
    marketplaceId: schedule.marketplace_id,
  });

  if (started.started === false) {
    return {
      ...base,
      status: "SKIPPED",
      reason: started.reason,
    };
  }

  try {
    const { job, reportId } = await requestFbaCountryReportJob({
      marketplaceIds: getScheduleMarketplaceIds(schedule),
    });

    await finishAmazonReportSyncRunSuccess(
      started.runId,
      {
        stage: "request_created",
        reportType: FBA_COUNTRY_REPORT_TYPE,
        reportId,
        amazonReportJobId: job.id,
      },
      job.id,
    );

    return {
      ...base,
      status: "SUCCESS",
      runId: started.runId,
      amazonReportJobId: job.id,
      reportId,
    };
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    await finishAmazonReportSyncRunError(started.runId, mapped.message);

    return {
      ...base,
      status: "ERROR",
      runId: started.runId,
      error: mapped.message,
    };
  }
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "No autorizado" },
      { status: 401 },
    );
  }

  try {
    const schedules = await listDueAmazonReportSchedules(new Date());
    const results: CronScheduleResult[] = [];

    for (const schedule of schedules) {
      results.push(await processSchedule(schedule));
    }

    return NextResponse.json({
      ok: true,
      totalDue: schedules.length,
      requested: results.filter((result) => result.status === "SUCCESS").length,
      skipped: results.filter((result) => result.status === "SKIPPED").length,
      errors: results.filter((result) => result.status === "ERROR").length,
      results,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, code: mapped.code, error: mapped.message },
      { status: mapped.status ?? 400 },
    );
  }
}
