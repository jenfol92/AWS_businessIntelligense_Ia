import test from "node:test";
import assert from "node:assert/strict";
import { runWithCanonicalSyncLease } from "./canonicalSyncCoordinator.ts";

test("simultaneous canonical calls execute one Amazon owner", async () => {
  let owner = false;
  let amazonExecutions = 0;
  const call = () => runWithCanonicalSyncLease({
    gateAction: async () => null,
    acquireLease: async () => {
      if (owner) return false;
      owner = true;
      return true;
    },
    execute: async () => { amazonExecutions += 1; return "done"; },
  });
  const results = await Promise.all([call(), call()]);
  assert.equal(amazonExecutions, 1);
  assert.deepEqual(results.map((result) => result.action).sort(), ["owned", "skipped_running"]);
});

test("server-side lease remains authoritative for a double click", async () => {
  let acquisitions = 0;
  const acquireLease = async () => ++acquisitions === 1;
  const results = await Promise.all([1, 2].map(() => runWithCanonicalSyncLease({
    gateAction: async () => null,
    acquireLease,
    execute: async () => "synced",
  })));
  assert.equal(results.filter((result) => result.action === "owned").length, 1);
});
