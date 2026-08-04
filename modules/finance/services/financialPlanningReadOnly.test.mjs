import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

const read = (file) => readFile(path.join(process.cwd(), file), "utf8");

test("planning GET and builder do not import or call supplier-payment synchronization", async () => {
  const route = await read("app/api/finance/planning/route.ts");
  const builder = await read("modules/finance/services/buildFinancialPlanning.ts");
  for (const [name, text] of [["route", route], ["builder", builder]]) {
    assert.doesNotMatch(text, /backfillMissingSupplierPayments/, name);
    assert.doesNotMatch(text, /syncSupplierPaymentsForOrder/, name);
  }
});

test("planning GET delegates only to the read builder after authorization", async () => {
  const route = await read("app/api/finance/planning/route.ts");
  assert.match(route, /requireTreasuryAccess\s*\(/);
  assert.match(route, /buildFinancialPlanning\s*\(/);
  assert.doesNotMatch(route, /\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.upsert\s*\(/);
});

test("planning builder retains a read-repository boundary", async () => {
  const builder = await read("modules/finance/services/buildFinancialPlanning.ts");
  assert.match(builder, /findFinancialPlanningData\s*\(/);
  assert.doesNotMatch(builder, /\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.upsert\s*\(/);
});
