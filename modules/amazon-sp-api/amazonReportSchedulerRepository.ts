import { supabaseAdmin } from "@/server/supabase/adminClient";
import type {
  AmazonReportScheduleRow,
  AmazonReportSyncRunRow,
  StartAmazonReportSyncRunInput,
  StartAmazonReportSyncRunResult,
} from "./amazonReportSchedulerTypes";

type StartRunRpcRow = {
  started: boolean;
  run_id: string | null;
  reason: string | null;
};

function toIso(input: Date): string {
  return input.toISOString();
}

export async function listDueAmazonReportSchedules(
  now: Date,
): Promise<AmazonReportScheduleRow[]> {
  const nowIso = toIso(now);
  const { data, error } = await supabaseAdmin
    .from("amazon_report_schedules")
    .select("*")
    .eq("enabled", true)
    .or(`last_requested_at.is.null,last_requested_at.lte.${nowIso}`)
    .order("last_requested_at", { ascending: true, nullsFirst: true });

  if (error) throw new Error(error.message);

  return ((data ?? []) as AmazonReportScheduleRow[]).filter((schedule) => {
    if (!schedule.last_requested_at) return true;
    const lastRequestedAt = new Date(schedule.last_requested_at).getTime();
    if (!Number.isFinite(lastRequestedAt)) return true;
    const dueAt = lastRequestedAt + schedule.frequency_minutes * 60_000;
    return dueAt <= now.getTime();
  });
}

export async function startAmazonReportSyncRun(
  input: StartAmazonReportSyncRunInput,
): Promise<StartAmazonReportSyncRunResult> {
  const { data, error } = await supabaseAdmin.rpc(
    "start_amazon_report_sync_run",
    {
      p_schedule_id: input.scheduleId,
      p_report_type: input.reportType,
      p_marketplace_country: input.marketplaceCountry ?? null,
      p_marketplace_id: input.marketplaceId ?? null,
      p_lock_minutes: input.lockMinutes ?? 30,
    },
  );

  if (error) throw new Error(error.message);

  const row = ((data ?? []) as StartRunRpcRow[])[0];
  if (!row?.started) return { started: false, reason: "LOCKED" };
  if (!row.run_id) throw new Error("La RPC start_amazon_report_sync_run no devolvió run_id.");

  return { started: true, runId: row.run_id };
}

export async function findActiveAmazonReportSyncRun(params: {
  reportType: string;
  marketplaceCountry?: string | null;
  marketplaceId?: string | null;
}): Promise<AmazonReportSyncRunRow | null> {
  let query = supabaseAdmin
    .from("amazon_report_sync_runs")
    .select("*")
    .eq("report_type", params.reportType)
    .eq("status", "RUNNING")
    .gt("lock_expires_at", new Date().toISOString())
    .order("started_at", { ascending: false })
    .limit(1);
  query = params.marketplaceCountry == null
    ? query.is("marketplace_country", null)
    : query.eq("marketplace_country", params.marketplaceCountry);
  query = params.marketplaceId == null
    ? query.is("marketplace_id", null)
    : query.eq("marketplace_id", params.marketplaceId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return (data as AmazonReportSyncRunRow | null) ?? null;
}

export async function markExpiredAmazonReportSyncRunsFailed(params: {
  reportType: string;
  now?: Date;
}): Promise<number> {
  const nowIso = (params.now ?? new Date()).toISOString();
  const { data, error } = await supabaseAdmin
    .from("amazon_report_sync_runs")
    .update({
      status: "ERROR",
      finished_at: nowIso,
      error: "STALE_LOCK_EXPIRED",
    })
    .eq("report_type", params.reportType)
    .eq("status", "RUNNING")
    .is("marketplace_country", null)
    .is("marketplace_id", null)
    .lte("lock_expires_at", nowIso)
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function heartbeatAmazonReportSyncRun(params: {
  runId: string;
  leaseMinutes: number;
  amazonReportJobId?: string | null;
}): Promise<AmazonReportSyncRunRow> {
  const now = new Date();
  const lockExpiresAt = new Date(
    now.getTime() + params.leaseMinutes * 60_000,
  ).toISOString();
  const { data, error } = await supabaseAdmin
    .from("amazon_report_sync_runs")
    .update({
      locked_at: now.toISOString(),
      lock_expires_at: lockExpiresAt,
      ...(params.amazonReportJobId
        ? { amazon_report_job_id: params.amazonReportJobId }
        : {}),
    })
    .eq("id", params.runId)
    .eq("status", "RUNNING")
    .gt("lock_expires_at", now.toISOString())
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("LEDGER_EXECUTION_LOCK_LOST");
  return data as AmazonReportSyncRunRow;
}

export async function markAmazonReportScheduleRequested(
  scheduleId: string,
  requestedAt: Date = new Date(),
  options: { markSuccess?: boolean } = {},
): Promise<AmazonReportScheduleRow> {
  const requestedAtIso = toIso(requestedAt);
  const markSuccess = options.markSuccess ?? true;
  const { data, error } = await supabaseAdmin
    .from("amazon_report_schedules")
    .update({
      last_requested_at: requestedAtIso,
      ...(markSuccess ? { last_success_at: requestedAtIso } : {}),
      last_error_at: null,
      last_error: null,
      updated_at: requestedAtIso,
    })
    .eq("id", scheduleId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return data as AmazonReportScheduleRow;
}

export async function markAmazonReportScheduleError(
  scheduleId: string,
  errorMessage: string,
  erroredAt: Date = new Date(),
): Promise<AmazonReportScheduleRow> {
  const erroredAtIso = toIso(erroredAt);
  const { data, error } = await supabaseAdmin
    .from("amazon_report_schedules")
    .update({
      last_error_at: erroredAtIso,
      last_error: errorMessage,
      updated_at: erroredAtIso,
    })
    .eq("id", scheduleId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  return data as AmazonReportScheduleRow;
}

export async function finishAmazonReportSyncRunSuccess(
  runId: string,
  summary: Record<string, unknown> | null = null,
  amazonReportJobId: string | null = null,
): Promise<AmazonReportSyncRunRow> {
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("amazon_report_sync_runs")
    .update({
      status: "SUCCESS",
      finished_at: finishedAt,
      amazon_report_job_id: amazonReportJobId,
      summary,
      error: null,
    })
    .eq("id", runId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const run = data as AmazonReportSyncRunRow;
  if (run.schedule_id) {
    const { error: scheduleError } = await supabaseAdmin
      .from("amazon_report_schedules")
      .update({
        last_success_at: finishedAt,
        last_error: null,
        updated_at: finishedAt,
      })
      .eq("id", run.schedule_id);

    if (scheduleError) throw new Error(scheduleError.message);
  }

  return run;
}

export async function finishAmazonReportSyncRunError(
  runId: string,
  errorMessage: string,
): Promise<AmazonReportSyncRunRow> {
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("amazon_report_sync_runs")
    .update({
      status: "ERROR",
      finished_at: finishedAt,
      error: errorMessage,
    })
    .eq("id", runId)
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  const run = data as AmazonReportSyncRunRow;
  if (run.schedule_id) {
    const { error: scheduleError } = await supabaseAdmin
      .from("amazon_report_schedules")
      .update({
        last_error_at: finishedAt,
        last_error: errorMessage,
        updated_at: finishedAt,
      })
      .eq("id", run.schedule_id);

    if (scheduleError) throw new Error(scheduleError.message);
  }

  return run;
}
