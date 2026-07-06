export {
  finishAmazonReportSyncRunError,
  finishAmazonReportSyncRunSuccess,
  listDueAmazonReportSchedules,
  markAmazonReportScheduleError,
  markAmazonReportScheduleRequested,
  startAmazonReportSyncRun,
} from "./amazonReportSchedulerRepository";
import { FBA_COUNTRY_REPORT_TYPE } from "./config";
import { mapGenericError } from "./errors";
import {
  commitFbaCountryReportJob,
  downloadAndPreviewFbaCountryReportJob,
  requestFbaCountryReportJob,
} from "./fbaCountryReportService";
import {
  findLatestImportedAmazonReportJob,
  findBlockingAmazonReportJob,
  listAmazonReportJobsReadyForPreview,
  listAmazonReportJobsReadyToCommit,
  listAmazonReportJobsPendingPoll,
  updateReportJob,
} from "./reportJobsRepository";
import { getReport, mapAmazonProcessingToJobStatus } from "./reportsClient";
import {
  finishAmazonReportSyncRunError,
  finishAmazonReportSyncRunSuccess,
  listDueAmazonReportSchedules,
  markAmazonReportScheduleError,
  markAmazonReportScheduleRequested,
  startAmazonReportSyncRun,
} from "./amazonReportSchedulerRepository";
export type {
  AmazonReportScheduleRow as AmazonReportSchedule,
  AmazonReportSyncRunRow as AmazonReportSyncRun,
  StartAmazonReportSyncRunInput,
  StartAmazonReportSyncRunResult,
} from "./amazonReportSchedulerTypes";
import type { AmazonReportScheduleRow } from "./amazonReportSchedulerTypes";

export type AmazonReportRequestDueResult = {
  scheduleId: string;
  runId?: string;
  reportType: string;
  marketplaceCountry: string | null;
  marketplaceId: string | null;
  action: "requested" | "skipped_locked" | "skipped_existing_job" | "error";
  marketplaceIdsSent?: string[];
  usedManualDefaultMarketplaceIds?: boolean;
  existingAmazonReportJobId?: string;
  existingReportId?: string | null;
  existingStatus?: string;
  existingProcessingStatus?: string | null;
  reportId?: string;
  amazonReportJobId?: string;
  error?: string;
};

export type AmazonReportRequestDueSummary = {
  processed: number;
  requested: number;
  skippedLocked: number;
  skippedExistingJob: number;
  errors: number;
  results: AmazonReportRequestDueResult[];
};

export type AmazonReportPollResult = {
  jobId: string;
  reportId: string;
  beforeStatus: string;
  afterStatus: string;
  beforeProcessingStatus: string | null;
  afterProcessingStatus: string | null;
  reportDocumentId: string | null;
  action: "updated" | "done" | "failed" | "error";
  error?: string;
};

export type AmazonReportPollSummary = {
  checked: number;
  done: number;
  stillPending: number;
  failed: number;
  errors: number;
  results: AmazonReportPollResult[];
};

export type AmazonReportPreviewResult = {
  jobId: string;
  reportId: string | null;
  reportType: string;
  action: "previewed" | "skipped" | "error";
  rows?: number;
  productsMatched?: number;
  productsUnmatched?: number;
  countries?: string[];
  error?: string;
};

export type AmazonReportPreviewSummary = {
  checked: number;
  previewed: number;
  skipped: number;
  errors: number;
  results: AmazonReportPreviewResult[];
};

export type AmazonReportReadyToCommitItem = {
  jobId: string;
  reportId: string | null;
  reportType: string;
  lastPreviewAt: string | null;
  productsMatched: number | null;
  productsUnmatched: number | null;
  warnings: number | null;
  countries: string[];
  debugStatus?: string;
  debugHasImportedAt?: boolean;
  debugHasImportSummary?: boolean;
};

export type AmazonReportCommitReadyResult = {
  jobId: string;
  reportId: string | null;
  reportType: string;
  action: "committed" | "skipped_superseded" | "error";
  supersededByJobId?: string;
  supersededByReportId?: string | null;
  inventarioPaisesUpserted?: number;
  historySnapshotsUpserted?: number;
  error?: string;
};

export type AmazonReportCommitReadySummary = {
  checked: number;
  committed: number;
  skippedSuperseded: number;
  errors: number;
  results: AmazonReportCommitReadyResult[];
};

export type AmazonReportRunSafeSummary = {
  steps: {
    poll: Pick<
      AmazonReportPollSummary,
      "checked" | "done" | "stillPending" | "failed" | "errors"
    >;
    preview: Pick<
      AmazonReportPreviewSummary,
      "checked" | "previewed" | "skipped" | "errors"
    >;
    commit: Pick<
      AmazonReportCommitReadySummary,
      "checked" | "committed" | "skippedSuperseded" | "errors"
    >;
    requestDue: Pick<
      AmazonReportRequestDueSummary,
      "processed" | "requested" | "skippedLocked" | "skippedExistingJob" | "errors"
    >;
  };
  readyToCommit: AmazonReportReadyToCommitItem[];
  skippedSuperseded: AmazonReportCommitReadyResult[];
  errors: Array<{ step: "poll" | "preview" | "commit" | "requestDue"; count: number }>;
};

const SUPPORTED_FBA_COUNTRY_SCHEDULE_TYPES = new Set([
  FBA_COUNTRY_REPORT_TYPE,
  "FBA_COUNTRY",
]);

function shortErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function scheduleMarketplaceIds(schedule: AmazonReportScheduleRow): string[] | null {
  const marketplaceId = schedule.marketplace_id?.trim();
  return marketplaceId ? [marketplaceId] : null;
}

function scheduleBase(schedule: AmazonReportScheduleRow) {
  return {
    scheduleId: schedule.id,
    reportType: schedule.report_type,
    marketplaceCountry: schedule.marketplace_country,
    marketplaceId: schedule.marketplace_id,
  };
}

function blockingJobRecentSince(schedule: AmazonReportScheduleRow): Date {
  return new Date(Date.now() - schedule.frequency_minutes * 60_000);
}

function blockingJobRequestedAt(jobRequestedAt: string): Date {
  const requestedAt = new Date(jobRequestedAt);
  return Number.isFinite(requestedAt.getTime()) ? requestedAt : new Date();
}

function readPreviewSummary(raw: Record<string, unknown> | null) {
  const summary = raw?.lastPreviewSummary;
  if (!summary || typeof summary !== "object") return null;
  return summary as Record<string, unknown>;
}

function numberFromSummary(summary: Record<string, unknown>, key: string): number | null {
  const value = Number(summary[key]);
  return Number.isFinite(value) ? value : null;
}

function countriesFromSummary(summary: Record<string, unknown>): string[] {
  const value = summary.countries;
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter(Boolean);
}

function timestampMs(value: string | null): number {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function isJobOlderThanImported(
  job: { requested_at: string; updated_at: string },
  imported: { requested_at: string; updated_at: string } | null,
): boolean {
  if (!imported) return false;
  const jobTime = timestampMs(job.requested_at) || timestampMs(job.updated_at);
  const importedTime =
    timestampMs(imported.requested_at) || timestampMs(imported.updated_at);
  return importedTime > jobTime;
}

async function requestDueAmazonReportSchedule(
  schedule: AmazonReportScheduleRow,
): Promise<AmazonReportRequestDueResult> {
  const base = scheduleBase(schedule);

  if (!SUPPORTED_FBA_COUNTRY_SCHEDULE_TYPES.has(schedule.report_type)) {
    const error = shortErrorMessage(
      `Report type no soportado en esta fase: ${schedule.report_type}`,
    );
    console.warn("[amazon-report-scheduler] unsupported schedule", {
      scheduleId: schedule.id,
      reportType: schedule.report_type,
    });
    await markAmazonReportScheduleError(schedule.id, error);
    return { ...base, action: "error", error };
  }

  const started = await startAmazonReportSyncRun({
    scheduleId: schedule.id,
    reportType: schedule.report_type,
    marketplaceCountry: schedule.marketplace_country,
    marketplaceId: schedule.marketplace_id,
  });

  if (started.started === false) {
    console.info("[amazon-report-scheduler] schedule locked", {
      scheduleId: schedule.id,
      reportType: schedule.report_type,
      marketplaceCountry: schedule.marketplace_country,
      marketplaceId: schedule.marketplace_id,
    });
    return { ...base, action: "skipped_locked" };
  }

  try {
    const blockingJob = await findBlockingAmazonReportJob({
      reportType: FBA_COUNTRY_REPORT_TYPE,
      recentSince: blockingJobRecentSince(schedule),
    });

    if (blockingJob) {
      const existingJob = blockingJob.job;
      const existingRequestedAt = blockingJobRequestedAt(existingJob.requested_at);

      await finishAmazonReportSyncRunSuccess(
        started.runId,
        {
          action: "skipped_existing_job",
          reason: blockingJob.reason,
          reportType: FBA_COUNTRY_REPORT_TYPE,
          existingAmazonReportJobId: existingJob.id,
          existingReportId: existingJob.report_id,
          existingStatus: existingJob.status,
          existingProcessingStatus: existingJob.processing_status,
          existingRequestedAt: existingJob.requested_at,
        },
        existingJob.id,
      );
      await markAmazonReportScheduleRequested(schedule.id, existingRequestedAt, {
        markSuccess: blockingJob.reason === "recent_success",
      });

      console.info("[amazon-report-scheduler] skipped existing job", {
        scheduleId: schedule.id,
        runId: started.runId,
        reportType: FBA_COUNTRY_REPORT_TYPE,
        marketplaceCountry: schedule.marketplace_country,
        marketplaceId: schedule.marketplace_id,
        existingAmazonReportJobId: existingJob.id,
        existingReportId: existingJob.report_id,
        existingStatus: existingJob.status,
        existingProcessingStatus: existingJob.processing_status,
        existingRequestedAt: existingJob.requested_at,
        reason: blockingJob.reason,
      });

      return {
        ...base,
        action: "skipped_existing_job",
        runId: started.runId,
        existingAmazonReportJobId: existingJob.id,
        existingReportId: existingJob.report_id,
        existingStatus: existingJob.status,
        existingProcessingStatus: existingJob.processing_status,
      };
    }

    const scheduleSpecificMarketplaceIds = scheduleMarketplaceIds(schedule);
    const usesManualDefaultMarketplaceIds = scheduleSpecificMarketplaceIds == null;

    console.info("[amazon-report-scheduler] createReport input resolved", {
      scheduleId: schedule.id,
      runId: started.runId,
      reportType: FBA_COUNTRY_REPORT_TYPE,
      marketplaceCountry: schedule.marketplace_country,
      marketplaceId: schedule.marketplace_id,
      marketplaceIds: scheduleSpecificMarketplaceIds,
      usesManualDefaultMarketplaceIds,
    });

    const { job, reportId, marketplaceIds, usedDefaultMarketplaceIds } =
      usesManualDefaultMarketplaceIds
        ? await requestFbaCountryReportJob({ source: "scheduler" })
        : await requestFbaCountryReportJob({
            marketplaceIds: scheduleSpecificMarketplaceIds,
            source: "scheduler",
          });

    await finishAmazonReportSyncRunSuccess(
      started.runId,
      {
        stage: "request_created",
        reportType: FBA_COUNTRY_REPORT_TYPE,
        reportId,
        amazonReportJobId: job.id,
        marketplaceIds,
        usedDefaultMarketplaceIds,
      },
      job.id,
    );
    await markAmazonReportScheduleRequested(schedule.id);

    console.info("[amazon-report-scheduler] report requested", {
      scheduleId: schedule.id,
      runId: started.runId,
      reportType: FBA_COUNTRY_REPORT_TYPE,
      marketplaceCountry: schedule.marketplace_country,
      marketplaceId: schedule.marketplace_id,
      marketplaceIds,
      usedDefaultMarketplaceIds,
      reportId,
      jobId: job.id,
    });

    return {
      ...base,
      action: "requested",
      runId: started.runId,
      marketplaceIdsSent: marketplaceIds,
      usedManualDefaultMarketplaceIds: usedDefaultMarketplaceIds,
      reportId,
      amazonReportJobId: job.id,
    };
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    const message = shortErrorMessage(mapped.message);
    await finishAmazonReportSyncRunError(started.runId, message);
    await markAmazonReportScheduleError(schedule.id, message);

    console.error("[amazon-report-scheduler] request error", {
      scheduleId: schedule.id,
      runId: started.runId,
      reportType: schedule.report_type,
      marketplaceCountry: schedule.marketplace_country,
      marketplaceId: schedule.marketplace_id,
      error: message,
    });

    return {
      ...base,
      action: "error",
      runId: started.runId,
      error: message,
    };
  }
}

export async function requestDueAmazonReportSchedules(
  now: Date = new Date(),
): Promise<AmazonReportRequestDueSummary> {
  const schedules = await listDueAmazonReportSchedules(now);
  console.info("[amazon-report-scheduler] due schedules found", {
    count: schedules.length,
  });

  const results: AmazonReportRequestDueResult[] = [];
  for (const schedule of schedules) {
    results.push(await requestDueAmazonReportSchedule(schedule));
  }

  return {
    processed: schedules.length,
    requested: results.filter((result) => result.action === "requested").length,
    skippedLocked: results.filter((result) => result.action === "skipped_locked").length,
    skippedExistingJob: results.filter((result) => result.action === "skipped_existing_job")
      .length,
    errors: results.filter((result) => result.action === "error").length,
    results,
  };
}

export async function pollPendingAmazonReportJobs(): Promise<AmazonReportPollSummary> {
  const jobs = await listAmazonReportJobsPendingPoll();
  console.info("[amazon-report-scheduler] pending report jobs found", {
    count: jobs.length,
  });

  const results: AmazonReportPollResult[] = [];

  for (const job of jobs) {
    const reportId = job.report_id;
    if (!reportId) continue;

    const beforeStatus = job.status;
    const beforeProcessingStatus = job.processing_status;

    try {
      const report = await getReport(reportId);
      const processingStatus = report.processingStatus;
      const mappedStatus = mapAmazonProcessingToJobStatus(processingStatus);
      const isDone = processingStatus === "DONE";
      const isFailed = processingStatus === "FATAL" || processingStatus === "CANCELLED";

      const updated = await updateReportJob(job.id, {
        processing_status: processingStatus,
        status: mappedStatus,
        report_document_id: report.reportDocumentId ?? job.report_document_id,
        completed_at: isDone ? new Date().toISOString() : job.completed_at,
        error_message: isFailed ? `Informe Amazon ${processingStatus}` : job.error_message,
        raw: {
          ...(job.raw ?? {}),
          lastReportSnapshot: report,
        },
      });

      console.info("[amazon-report-scheduler] report job polled", {
        jobId: job.id,
        reportId,
        beforeStatus,
        afterStatus: updated.status,
        beforeProcessingStatus,
        afterProcessingStatus: updated.processing_status,
        reportDocumentId: updated.report_document_id,
      });

      results.push({
        jobId: job.id,
        reportId,
        beforeStatus,
        afterStatus: updated.status,
        beforeProcessingStatus,
        afterProcessingStatus: updated.processing_status,
        reportDocumentId: updated.report_document_id,
        action: isDone ? "done" : isFailed ? "failed" : "updated",
        error: isFailed ? updated.error_message ?? undefined : undefined,
      });
    } catch (error: unknown) {
      const mapped = mapGenericError(error);
      console.error("[amazon-report-scheduler] report job poll error", {
        jobId: job.id,
        reportId,
        beforeStatus,
        beforeProcessingStatus,
        error: mapped.message,
      });

      results.push({
        jobId: job.id,
        reportId,
        beforeStatus,
        afterStatus: beforeStatus,
        beforeProcessingStatus,
        afterProcessingStatus: beforeProcessingStatus,
        reportDocumentId: job.report_document_id,
        action: "error",
        error: mapped.message,
      });
    }
  }

  return {
    checked: jobs.length,
    done: results.filter((result) => result.action === "done").length,
    stillPending: results.filter((result) => result.action === "updated").length,
    failed: results.filter((result) => result.action === "failed").length,
    errors: results.filter((result) => result.action === "error").length,
    results,
  };
}

export async function previewReadyAmazonReportJobs(): Promise<AmazonReportPreviewSummary> {
  const jobs = await listAmazonReportJobsReadyForPreview({
    reportType: FBA_COUNTRY_REPORT_TYPE,
  });
  console.info("[amazon-report-scheduler] ready report jobs for preview found", {
    count: jobs.length,
    reportType: FBA_COUNTRY_REPORT_TYPE,
  });

  const results: AmazonReportPreviewResult[] = [];

  for (const job of jobs) {
    try {
      const { job: updatedJob, preview } = await downloadAndPreviewFbaCountryReportJob(
        job.id,
      );
      const productsUnmatched = preview.skippedUnlinkedRows;
      const productsMatched = preview.validRows - productsUnmatched;
      const countries = preview.rowsByCountry.map((row) => row.key);

      console.info("[amazon-report-scheduler] report job previewed", {
        jobId: job.id,
        reportId: job.report_id,
        reportType: job.report_type,
        status: updatedJob.status,
        rows: preview.validRows,
        productsMatched,
        productsUnmatched,
        countries,
      });

      results.push({
        jobId: job.id,
        reportId: job.report_id,
        reportType: job.report_type,
        action: "previewed",
        rows: preview.validRows,
        productsMatched,
        productsUnmatched,
        countries,
      });
    } catch (error: unknown) {
      const mapped = mapGenericError(error);
      console.error("[amazon-report-scheduler] report job preview error", {
        jobId: job.id,
        reportId: job.report_id,
        reportType: job.report_type,
        error: mapped.message,
      });

      results.push({
        jobId: job.id,
        reportId: job.report_id,
        reportType: job.report_type,
        action: "error",
        error: mapped.message,
      });
    }
  }

  return {
    checked: jobs.length,
    previewed: results.filter((result) => result.action === "previewed").length,
    skipped: results.filter((result) => result.action === "skipped").length,
    errors: results.filter((result) => result.action === "error").length,
    results,
  };
}

export async function listReadyToCommitAmazonReportJobs(): Promise<
  AmazonReportReadyToCommitItem[]
> {
  const jobs = await listAmazonReportJobsReadyToCommit({
    reportType: FBA_COUNTRY_REPORT_TYPE,
  });

  return jobs
    .filter((job) => {
      if (job.status !== "PARSED_PREVIEW") return false;
      if (job.processing_status !== "DONE") return false;
      if (job.error_message) return false;
      if (job.raw?.importedAt || job.raw?.importSummary) return false;
      const summary = readPreviewSummary(job.raw);
      if (!summary) return false;
      return (
        numberFromSummary(summary, "productsUnmatched") === 0 &&
        numberFromSummary(summary, "warnings") === 0
      );
    })
    .map((job) => {
      const summary = readPreviewSummary(job.raw) ?? {};
      const item: AmazonReportReadyToCommitItem = {
        jobId: job.id,
        reportId: job.report_id,
        reportType: job.report_type,
        lastPreviewAt:
          typeof job.raw?.lastPreviewAt === "string" ? job.raw.lastPreviewAt : null,
        productsMatched: numberFromSummary(summary, "productsMatched"),
        productsUnmatched: numberFromSummary(summary, "productsUnmatched"),
        warnings: numberFromSummary(summary, "warnings"),
        countries: countriesFromSummary(summary),
      };
      if (process.env.NODE_ENV !== "production") {
        item.debugStatus = job.status;
        item.debugHasImportedAt = Boolean(job.raw?.importedAt);
        item.debugHasImportSummary = Boolean(job.raw?.importSummary);
      }
      return item;
    });
}

export async function commitReadyAmazonReportJobs(): Promise<AmazonReportCommitReadySummary> {
  const jobs = await listAmazonReportJobsReadyToCommit({
    reportType: FBA_COUNTRY_REPORT_TYPE,
  });
  const latestImported = await findLatestImportedAmazonReportJob({
    reportType: FBA_COUNTRY_REPORT_TYPE,
  });

  console.info("[amazon-report-scheduler] ready report jobs for commit found", {
    count: jobs.length,
    reportType: FBA_COUNTRY_REPORT_TYPE,
    latestImportedJobId: latestImported?.id ?? null,
    latestImportedReportId: latestImported?.report_id ?? null,
  });

  const results: AmazonReportCommitReadyResult[] = [];

  for (const job of jobs) {
    if (isJobOlderThanImported(job, latestImported)) {
      await updateReportJob(job.id, {
        raw: {
          ...(job.raw ?? {}),
          supersededAt: new Date().toISOString(),
          supersededByJobId: latestImported?.id ?? null,
          supersededByReportId: latestImported?.report_id ?? null,
          supersededReason:
            "Skipped by scheduler because a newer job of the same report_type is already IMPORTED.",
        },
      });

      console.warn("[amazon-report-scheduler] report job skipped superseded", {
        jobId: job.id,
        reportId: job.report_id,
        reportType: job.report_type,
        supersededByJobId: latestImported?.id ?? null,
        supersededByReportId: latestImported?.report_id ?? null,
      });

      results.push({
        jobId: job.id,
        reportId: job.report_id,
        reportType: job.report_type,
        action: "skipped_superseded",
        supersededByJobId: latestImported?.id,
        supersededByReportId: latestImported?.report_id ?? null,
      });
      continue;
    }

    try {
      const { job: updatedJob, commit } = await commitFbaCountryReportJob(job.id);
      console.info("[amazon-report-scheduler] report job auto committed", {
        jobId: updatedJob.id,
        reportId: updatedJob.report_id,
        reportType: updatedJob.report_type,
        inventarioPaisesUpserted: commit.inventarioPaisesUpserted,
        historySnapshotsUpserted: commit.historySnapshotsUpserted,
      });

      results.push({
        jobId: updatedJob.id,
        reportId: updatedJob.report_id,
        reportType: updatedJob.report_type,
        action: "committed",
        inventarioPaisesUpserted: commit.inventarioPaisesUpserted,
        historySnapshotsUpserted: commit.historySnapshotsUpserted,
      });
    } catch (error: unknown) {
      const mapped = mapGenericError(error);
      console.error("[amazon-report-scheduler] report job commit error", {
        jobId: job.id,
        reportId: job.report_id,
        reportType: job.report_type,
        error: mapped.message,
      });

      results.push({
        jobId: job.id,
        reportId: job.report_id,
        reportType: job.report_type,
        action: "error",
        error: mapped.message,
      });
    }
  }

  return {
    checked: jobs.length,
    committed: results.filter((result) => result.action === "committed").length,
    skippedSuperseded: results.filter(
      (result) => result.action === "skipped_superseded",
    ).length,
    errors: results.filter((result) => result.action === "error").length,
    results,
  };
}

export async function runSafeAmazonReportScheduler(): Promise<AmazonReportRunSafeSummary> {
  const poll = await pollPendingAmazonReportJobs();
  const preview = await previewReadyAmazonReportJobs();
  const commit = await commitReadyAmazonReportJobs();
  const requestDue = await requestDueAmazonReportSchedules();
  const readyToCommit = await listReadyToCommitAmazonReportJobs();
  const errorSteps: AmazonReportRunSafeSummary["errors"] = [
    { step: "poll", count: poll.errors },
    { step: "preview", count: preview.errors },
    { step: "commit", count: commit.errors },
    { step: "requestDue", count: requestDue.errors },
  ];
  const errors = errorSteps.filter((item) => item.count > 0);

  return {
    steps: {
      poll: {
        checked: poll.checked,
        done: poll.done,
        stillPending: poll.stillPending,
        failed: poll.failed,
        errors: poll.errors,
      },
      preview: {
        checked: preview.checked,
        previewed: preview.previewed,
        skipped: preview.skipped,
        errors: preview.errors,
      },
      commit: {
        checked: commit.checked,
        committed: commit.committed,
        skippedSuperseded: commit.skippedSuperseded,
        errors: commit.errors,
      },
      requestDue: {
        processed: requestDue.processed,
        requested: requestDue.requested,
        skippedLocked: requestDue.skippedLocked,
        skippedExistingJob: requestDue.skippedExistingJob,
        errors: requestDue.errors,
      },
    },
    readyToCommit,
    skippedSuperseded: commit.results.filter(
      (result) => result.action === "skipped_superseded",
    ),
    errors,
  };
}
