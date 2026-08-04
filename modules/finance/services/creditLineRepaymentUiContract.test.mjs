import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat();
}

test("every repayment API consumer sends the Phase 1B component contract", async () => {
  const roots = [path.join(process.cwd(), "app"), path.join(process.cwd(), "modules")];
  const files = (await Promise.all(roots.map(sourceFiles))).flat();
  const consumers = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (/\/api\/finance\/credit-lines\/.*\/repay/.test(source)) consumers.push({ file, source });
  }

  assert.ok(consumers.length > 0, "expected at least one repayment API consumer");
  for (const { file, source } of consumers) {
    const payload = source.match(/body:\s*JSON\.stringify\(\{([\s\S]*?)\}\),/)?.[1] ?? "";
    assert.ok(payload, `missing JSON payload in ${file}`);
    for (const field of [
      "principalPaidEur", "interestPaidEur", "feesPaidEur", "effectiveDate",
      "cashAccountId", "repaymentGroupId", "idempotencyKey",
    ]) {
      assert.match(source, new RegExp(`\\b${field}\\b`), `${file} must send ${field}`);
    }
    assert.doesNotMatch(source, /\bamount\s*:/, `${file} must not send legacy amount`);
    assert.doesNotMatch(source, /\bmovementDate\b/, `${file} must not send legacy movementDate`);
    assert.doesNotMatch(source, /\btotal(?:CashOutEur)?\s*:/, `${file} must not send a client total`);
  }
});
