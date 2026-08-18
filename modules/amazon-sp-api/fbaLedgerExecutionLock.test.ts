import assert from "node:assert/strict";
import test from "node:test";
import {
  runWithFbaLedgerExecutionLockCore,
  type LedgerLockDependencies,
} from "./fbaLedgerExecutionLockCore.ts";

function harness() {
  let running = false;
  let stale = false;
  let jobId: string | null = null;
  let sequence = 0;
  const statuses: string[] = [];
  const deps: LedgerLockDependencies = {
    markStale: async () => {
      if (running && stale) {
        running = false;
        stale = false;
        statuses.push("FAILED");
        return 1;
      }
      return 0;
    },
    start: async () => {
      if (running) return { started: false, reason: "LOCKED" };
      running = true;
      sequence++;
      statuses.push("RUNNING");
      return { started: true, runId: `run-${sequence}` };
    },
    active: async () => running
      ? { id: `run-${sequence}`, amazon_report_job_id: jobId }
      : null,
    heartbeat: async ({ amazonReportJobId }) => {
      if (!running) throw new Error("LEDGER_EXECUTION_LOCK_LOST");
      jobId = amazonReportJobId;
      return {};
    },
    success: async () => {
      running = false;
      statuses.push("SUCCESS");
      return {};
    },
    failed: async () => {
      running = false;
      statuses.push("FAILED");
      return {};
    },
  };
  return { deps, statuses, makeStale: () => { stale = true; } };
}

test("dos requests concurrentes producen una sola intención Amazon", async () => {
  const state = harness();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let amazonRequestIntentCount = 0;
  const first = runWithFbaLedgerExecutionLockCore({
    operation: "REQUEST",
    dependencies: state.deps,
    heartbeatIntervalMs: 0,
    execute: async ({ setJobId }) => {
      amazonRequestIntentCount++;
      await setJobId("job-existing");
      await gate;
      return "A";
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = await runWithFbaLedgerExecutionLockCore({
    operation: "REQUEST",
    dependencies: state.deps,
    heartbeatIntervalMs: 0,
    execute: async () => {
      amazonRequestIntentCount++;
      return "B";
    },
  });
  assert.deepEqual(second, {
    acquired: false,
    code: "LEDGER_ALREADY_RUNNING",
    existingRunId: "run-1",
    existingJobId: "job-existing",
  });
  assert.equal(amazonRequestIntentCount, 1);
  release();
  assert.deepEqual(await first, { acquired: true, value: "A" });
  assert.deepEqual(state.statuses, ["RUNNING", "SUCCESS"]);

  const third = await runWithFbaLedgerExecutionLockCore({
    operation: "REQUEST",
    dependencies: state.deps,
    heartbeatIntervalMs: 0,
    execute: async () => {
      amazonRequestIntentCount++;
      return "C";
    },
  });
  assert.deepEqual(third, { acquired: true, value: "C" });
  assert.equal(amazonRequestIntentCount, 2);
});

test("FAILED libera el lock", async () => {
  const state = harness();
  await assert.rejects(
    runWithFbaLedgerExecutionLockCore({
      operation: "COMMIT",
      dependencies: state.deps,
      heartbeatIntervalMs: 0,
      execute: async () => { throw new Error("TEST_FAILURE"); },
    }),
    /TEST_FAILURE/,
  );
  assert.deepEqual(state.statuses, ["RUNNING", "FAILED"]);
  const next = await runWithFbaLedgerExecutionLockCore({
    operation: "COMMIT",
    dependencies: state.deps,
    heartbeatIntervalMs: 0,
    execute: async () => "RECOVERED",
  });
  assert.deepEqual(next, { acquired: true, value: "RECOVERED" });
});

test("un RUNNING stale se marca FAILED y puede recuperarse", async () => {
  const state = harness();
  await state.deps.start({
    scheduleId: null,
    reportType: "GET_LEDGER_SUMMARY_VIEW_DATA",
    marketplaceCountry: null,
    marketplaceId: null,
    lockMinutes: 30,
  });
  state.makeStale();
  const recovered = await runWithFbaLedgerExecutionLockCore({
    operation: "POLL",
    dependencies: state.deps,
    heartbeatIntervalMs: 0,
    execute: async () => "RECOVERED",
  });
  assert.deepEqual(recovered, { acquired: true, value: "RECOVERED" });
  assert.deepEqual(state.statuses, ["RUNNING", "FAILED", "RUNNING", "SUCCESS"]);
});
