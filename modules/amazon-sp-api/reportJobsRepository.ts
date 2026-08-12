import { supabaseAdmin } from "@/server/supabase/adminClient";
import type {
  AmazonSpApiReportJobRow,
  SpApiReportJobStatus,
} from "./types";

const FBA_LEDGER_REPORT_TYPE = "GET_LEDGER_SUMMARY_VIEW_DATA";

function numberFromPreviewSummary(
  summary: Record<string, unknown>,
  key: string,
): number {
  const value = Number(summary[key]);
  return Number.isFinite(value) ? value : 0;
}

function reportJobPassesCommitGate(job: AmazonSpApiReportJobRow): boolean {
  const summary = job.raw?.lastPreviewSummary;
  if (!summary || typeof summary !== "object") return false;
  const record = summary as Record<string, unknown>;
  const warnings = numberFromPreviewSummary(record, "warnings");
  if (job.report_type === FBA_LEDGER_REPORT_TYPE) {
    return warnings === 0 && numberFromPreviewSummary(record, "conflictRows") === 0;
  }

  return (
    warnings === 0 &&
    numberFromPreviewSummary(record, "productsUnmatched") === 0
  );
}

export async function createReportJob(params: {
  reportType: string;
  marketplaceIds: string[];
  source?: string;
}): Promise<AmazonSpApiReportJobRow> {
  const { data, error } = await supabaseAdmin
    .from("amazon_spapi_report_jobs")
    .insert({
      report_type: params.reportType,
      marketplace_ids: params.marketplaceIds,
      status: "CREATED",
      source: params.source ?? "amazon_spapi",
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as AmazonSpApiReportJobRow;
}

export async function getReportJobById(
  jobId: string,
): Promise<AmazonSpApiReportJobRow | null> {
  const { data, error } = await supabaseAdmin
    .from("amazon_spapi_report_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as AmazonSpApiReportJobRow | null) ?? null;
}

export type BlockingAmazonReportJobReason =
  | "open_job"
  | "pending"
  | "recent_success";

export type BlockingAmazonReportJob = {
  job: AmazonSpApiReportJobRow;
  reason: BlockingAmazonReportJobReason;
};

export async function findBlockingAmazonReportJob(params: {
  reportType: string;
  recentSince: Date;
}): Promise<BlockingAmazonReportJob | null> {
  const { data: openData, error: openError } = await supabaseAdmin
    .from("amazon_spapi_report_jobs")
    .select("*")
    .eq("report_type", params.reportType)
    .in("status", [
      "CREATED",
      "SUBMITTED",
      "IN_PROGRESS",
      "DONE",
      "DOWNLOADED",
      "PARSED_PREVIEW",
    ])
    .is("error_message", null)
    .order("requested_at", { ascending: false });

  if (openError) throw new Error(openError.message);

  const openJob = ((openData ?? []) as AmazonSpApiReportJobRow[]).find((job) => {
    if (job.raw?.importedAt || job.raw?.importSummary) return false;
    if (job.raw?.supersededAt) return false;
    return true;
  });
  if (openJob) {
    return { job: openJob, reason: "open_job" };
  }

  const { data: pendingData, error: pendingError } = await supabaseAdmin
    .from("amazon_spapi_report_jobs")
    .select("*")
    .eq("report_type", params.reportType)
    .or("status.eq.SUBMITTED,processing_status.in.(IN_QUEUE,IN_PROGRESS)")
    .order("requested_at", { ascending: false })
    .limit(1);

  if (pendingError) throw new Error(pendingError.message);

  const pendingJob = ((pendingData ?? []) as AmazonSpApiReportJobRow[])[0];
  if (pendingJob) {
    return { job: pendingJob, reason: "pending" };
  }

  const { data: recentData, error: recentError } = await supabaseAdmin
    .from("amazon_spapi_report_jobs")
    .select("*")
    .eq("report_type", params.reportType)
    .not("report_id", "is", null)
    .is("error_message", null)
    .gte("requested_at", params.recentSince.toISOString())
    .order("requested_at", { ascending: false })
    .limit(1);

  if (recentError) throw new Error(recentError.message);

  const recentJob = ((recentData ?? []) as AmazonSpApiReportJobRow[])[0];
  if (recentJob) {
    return { job: recentJob, reason: "recent_success" };
  }

  return null;
}

export async function listAmazonReportJobsPendingPoll(): Promise<
  AmazonSpApiReportJobRow[]
> {
  const { data, error } = await supabaseAdmin
    .from("amazon_spapi_report_jobs")
    .select("*")
    .not("report_id", "is", null)
    .is("report_document_id", null)
    .is("error_message", null)
    .or(
      "status.eq.SUBMITTED,processing_status.in.(IN_QUEUE,IN_PROGRESS,PROCESSING),processing_status.is.null",
    )
    .order("requested_at", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? []) as AmazonSpApiReportJobRow[];
}

export async function listAmazonReportJobsReadyForPreview(params: {
  reportType: string;
}): Promise<AmazonSpApiReportJobRow[]> {
  const { data, error } = await supabaseAdmin
    .from("amazon_spapi_report_jobs")
    .select("*")
    .eq("report_type", params.reportType)
    .not("report_document_id", "is", null)
    .eq("processing_status", "DONE")
    .eq("status", "DONE")
    .is("error_message", null)
    .order("completed_at", { ascending: true, nullsFirst: true });

  if (error) throw new Error(error.message);

  return ((data ?? []) as AmazonSpApiReportJobRow[]).filter((job) => {
    return !job.raw?.importedAt && !job.raw?.importSummary;
  });
}

export async function listAmazonReportJobsReadyToCommit(params: {
  reportType: string;
}): Promise<AmazonSpApiReportJobRow[]> {
  const { data, error } = await supabaseAdmin
    .from("amazon_spapi_report_jobs")
    .select("*")
    .eq("report_type", params.reportType)
    .eq("status", "PARSED_PREVIEW")
    .eq("processing_status", "DONE")
    .is("error_message", null)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);

  return ((data ?? []) as AmazonSpApiReportJobRow[]).filter((job) => {
    if (job.status !== "PARSED_PREVIEW") return false;
    if (job.processing_status !== "DONE") return false;
    if (job.error_message) return false;
    if (job.raw?.importedAt || job.raw?.importSummary) return false;
    if (job.raw?.supersededAt) return false;
    if (!getReportContentFromJob(job)) return false;
    return reportJobPassesCommitGate(job);
  });
}

export async function findLatestImportedAmazonReportJob(params: {
  reportType: string;
}): Promise<AmazonSpApiReportJobRow | null> {
  const { data, error } = await supabaseAdmin
    .from("amazon_spapi_report_jobs")
    .select("*")
    .eq("report_type", params.reportType)
    .eq("status", "IMPORTED")
    .is("error_message", null)
    .order("requested_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);

  return (((data ?? []) as AmazonSpApiReportJobRow[])[0] ?? null);
}

export async function updateReportJob(
  jobId: string,
  patch: Partial<{
    report_id: string | null;
    report_document_id: string | null;
    status: SpApiReportJobStatus;
    processing_status: string | null;
    completed_at: string | null;
    downloaded_at: string | null;
    error_message: string | null;
    raw: Record<string, unknown> | null;
  }>,
): Promise<AmazonSpApiReportJobRow> {
  const { data, error } = await supabaseAdmin
    .from("amazon_spapi_report_jobs")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as AmazonSpApiReportJobRow;
}

export function getReportContentFromJob(
  job: AmazonSpApiReportJobRow,
): string | null {
  const raw = job.raw;
  if (!raw || typeof raw !== "object") return null;
  const content = (raw as { reportContent?: unknown }).reportContent;
  return typeof content === "string" ? content : null;
}

export async function storeReportContentOnJob(
  jobId: string,
  reportContent: string,
  extraRaw?: Record<string, unknown>,
): Promise<AmazonSpApiReportJobRow> {
  const existing = await getReportJobById(jobId);
  const mergedRaw = {
    ...(existing?.raw ?? {}),
    ...(extraRaw ?? {}),
    reportContent,
    reportContentLength: reportContent.length,
  };

  return updateReportJob(jobId, {
    raw: mergedRaw,
    downloaded_at: new Date().toISOString(),
    status: "DOWNLOADED",
  });
}
