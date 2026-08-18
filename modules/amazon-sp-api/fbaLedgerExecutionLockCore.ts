export const FBA_LEDGER_EXECUTION_SCOPE = "GET_LEDGER_SUMMARY_VIEW_DATA";
export const FBA_LEDGER_LOCK_MINUTES = 30;
export const FBA_LEDGER_HEARTBEAT_MINUTES = 5;

type ActiveRun = { id: string; amazon_report_job_id: string | null };
type StartResult = { started: true; runId: string } | { started: false; reason: "LOCKED" };

export type LedgerLockDependencies = {
  start: (input: {
    scheduleId: string | null;
    reportType: string;
    marketplaceCountry: string | null;
    marketplaceId: string | null;
    lockMinutes: number;
  }) => Promise<StartResult>;
  active: (input: { reportType: string }) => Promise<ActiveRun | null>;
  markStale: (input: { reportType: string }) => Promise<number>;
  heartbeat: (input: {
    runId: string;
    leaseMinutes: number;
    amazonReportJobId: string | null;
  }) => Promise<unknown>;
  success: (
    runId: string,
    summary: Record<string, unknown> | null,
    amazonReportJobId: string | null,
  ) => Promise<unknown>;
  failed: (runId: string, errorMessage: string) => Promise<unknown>;
};

export type LedgerAlreadyRunning = {
  acquired: false;
  code: "LEDGER_ALREADY_RUNNING";
  existingRunId: string | null;
  existingJobId: string | null;
};

export class LedgerAlreadyRunningError extends Error {
  readonly code = "LEDGER_ALREADY_RUNNING";
  readonly existingRunId: string | null;
  readonly existingJobId: string | null;
  constructor(
    existingRunId: string | null,
    existingJobId: string | null,
  ) {
    super("LEDGER_ALREADY_RUNNING");
    this.existingRunId = existingRunId;
    this.existingJobId = existingJobId;
  }
}

export async function runWithFbaLedgerExecutionLockCore<T>(params: {
  operation: "REQUEST" | "POLL" | "PREVIEW" | "COMMIT";
  jobId?: string | null;
  execute: (control: { setJobId: (jobId: string) => Promise<void> }) => Promise<T>;
  dependencies: LedgerLockDependencies;
  heartbeatIntervalMs?: number;
}): Promise<{ acquired: true; value: T } | LedgerAlreadyRunning> {
  const deps = params.dependencies;
  await deps.markStale({ reportType: FBA_LEDGER_EXECUTION_SCOPE });
  const started = await deps.start({
    scheduleId: null,
    reportType: FBA_LEDGER_EXECUTION_SCOPE,
    marketplaceCountry: null,
    marketplaceId: null,
    lockMinutes: FBA_LEDGER_LOCK_MINUTES,
  });
  if (!started.started) {
    const active = await deps.active({ reportType: FBA_LEDGER_EXECUTION_SCOPE });
    return {
      acquired: false,
      code: "LEDGER_ALREADY_RUNNING",
      existingRunId: active?.id ?? null,
      existingJobId: active?.amazon_report_job_id ?? null,
    };
  }

  const intervalMs = params.heartbeatIntervalMs ?? FBA_LEDGER_HEARTBEAT_MINUTES * 60_000;
  let heartbeatError: unknown = null;
  let currentJobId = params.jobId ?? null;
  const renew = async () => {
    try {
      await deps.heartbeat({
        runId: started.runId,
        leaseMinutes: FBA_LEDGER_LOCK_MINUTES,
        amazonReportJobId: currentJobId,
      });
    } catch (error) {
      heartbeatError = error;
    }
  };
  await renew();
  if (heartbeatError) throw heartbeatError;
  const timer = intervalMs > 0 ? setInterval(() => void renew(), intervalMs) : null;

  try {
    const value = await params.execute({
      setJobId: async (jobId) => {
        currentJobId = jobId;
        await renew();
        if (heartbeatError) throw heartbeatError;
      },
    });
    if (heartbeatError) throw heartbeatError;
    await deps.success(
      started.runId,
      { operation: params.operation, executionStatus: "SUCCESS" },
      currentJobId,
    );
    return { acquired: true, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.failed(started.runId, message).catch(() => undefined);
    throw error;
  } finally {
    if (timer) clearInterval(timer);
  }
}

export function unwrapFbaLedgerExecution<T>(
  result: { acquired: true; value: T } | LedgerAlreadyRunning,
): T {
  if ("value" in result) return result.value;
  throw new LedgerAlreadyRunningError(result.existingRunId, result.existingJobId);
}
