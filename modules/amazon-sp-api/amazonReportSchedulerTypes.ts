export type AmazonReportScheduleRow = {
  id: string;
  report_type: string;
  marketplace_country: string | null;
  marketplace_id: string | null;
  frequency_minutes: number;
  enabled: boolean;
  last_requested_at: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type AmazonReportSyncRunStatus =
  | "RUNNING"
  | "SUCCESS"
  | "ERROR"
  | "SKIPPED_LOCKED";

export type AmazonReportSyncRunRow = {
  id: string;
  schedule_id: string | null;
  report_type: string;
  marketplace_country: string | null;
  marketplace_id: string | null;
  status: AmazonReportSyncRunStatus;
  started_at: string;
  finished_at: string | null;
  locked_at: string | null;
  lock_expires_at: string | null;
  amazon_report_job_id: string | null;
  error: string | null;
  summary: Record<string, unknown> | null;
  created_at: string;
};

export type StartAmazonReportSyncRunInput = {
  scheduleId: string;
  reportType: string;
  marketplaceCountry?: string | null;
  marketplaceId?: string | null;
  lockMinutes?: number;
};

export type StartAmazonReportSyncRunResult =
  | { started: true; runId: string }
  | { started: false; reason: "LOCKED" };
