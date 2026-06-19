import { supabaseAdmin } from "@/server/supabase/adminClient";
import type {
  AmazonSpApiReportJobRow,
  SpApiReportJobStatus,
} from "./types";

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
