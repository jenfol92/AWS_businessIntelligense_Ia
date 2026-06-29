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

  const { error: scheduleError } = await supabaseAdmin
    .from("amazon_report_schedules")
    .update({
      last_requested_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.scheduleId);

  if (scheduleError) throw new Error(scheduleError.message);

  return { started: true, runId: row.run_id };
}

export async function finishAmazonReportSyncRunSuccess(
  runId: string,
  summary: Record<string, unknown> | null = null,
): Promise<AmazonReportSyncRunRow> {
  const finishedAt = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("amazon_report_sync_runs")
    .update({
      status: "SUCCESS",
      finished_at: finishedAt,
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
