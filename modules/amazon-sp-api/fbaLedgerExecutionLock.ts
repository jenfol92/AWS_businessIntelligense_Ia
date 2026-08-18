import {
  findActiveAmazonReportSyncRun,
  finishAmazonReportSyncRunError,
  finishAmazonReportSyncRunSuccess,
  heartbeatAmazonReportSyncRun,
  markExpiredAmazonReportSyncRunsFailed,
  startAmazonReportSyncRun,
} from "./amazonReportSchedulerRepository";
import {
  runWithFbaLedgerExecutionLockCore,
  type LedgerLockDependencies,
} from "./fbaLedgerExecutionLockCore";

export {
  FBA_LEDGER_EXECUTION_SCOPE,
  FBA_LEDGER_HEARTBEAT_MINUTES,
  FBA_LEDGER_LOCK_MINUTES,
  LedgerAlreadyRunningError,
  unwrapFbaLedgerExecution,
} from "./fbaLedgerExecutionLockCore";

const dependencies: LedgerLockDependencies = {
  start: startAmazonReportSyncRun,
  active: findActiveAmazonReportSyncRun,
  markStale: markExpiredAmazonReportSyncRunsFailed,
  heartbeat: heartbeatAmazonReportSyncRun,
  success: finishAmazonReportSyncRunSuccess,
  failed: finishAmazonReportSyncRunError,
};

export async function runWithFbaLedgerExecutionLock<T>(params: {
  operation: "REQUEST" | "POLL" | "PREVIEW" | "COMMIT";
  jobId?: string | null;
  execute: (control: { setJobId: (jobId: string) => Promise<void> }) => Promise<T>;
}) {
  return runWithFbaLedgerExecutionLockCore({ ...params, dependencies });
}
