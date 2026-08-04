import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";

const READ_ROUTES = [
  "app/api/finance/planning/route.ts",
  "app/api/finance/credit-lines/maturities/route.ts",
];

const MUTATION_ROUTES = [
  "app/api/finance/credit-lines/[id]/repay/route.ts",
  "app/api/finance/supplier-payments/[id]/mark-paid/route.ts",
  "app/api/finance/supplier-payments/[id]/finance/route.ts",
  "app/api/finance/purchase-payment-batches/route.ts",
];

const routeFiles = [...READ_ROUTES, ...MUTATION_ROUTES];

async function source(relativePath) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

test("planning and maturities use the canonical treasury-read capability", async () => {
  for (const file of READ_ROUTES) {
    const text = await source(file);
    assert.match(text, /requireTreasuryAccess\s*\(/, file);
    assert.doesNotMatch(text, /requireFinanceDetailsAccess\s*\(/, file);
  }
});

test("finance mutation routes use the canonical admin/accounting capability", async () => {
  for (const file of MUTATION_ROUTES) {
    const text = await source(file);
    assert.match(text, /requireFinanceDetailsAccess\s*\(/, file);
    assert.doesNotMatch(text, /requireTreasuryAccess\s*\(/, file);
  }
});

test("all finance routes share stable access mapping without direct auth", async () => {
  for (const file of routeFiles) {
    const text = await source(file);
    assert.match(text, /getFinanceAccessErrorResponse\s*\(/, file);
    assert.doesNotMatch(text, /auth\.getUser\s*\(/, file);
  }
});

test("finance routes never use admin clients or service-role credentials", async () => {
  for (const file of routeFiles) {
    const text = await source(file);
    assert.doesNotMatch(text, /createSupabaseAdmin|adminClient|SERVICE_ROLE|service_role/i, file);
  }
});

test("access mapping uses fixed public responses", async () => {
  const text = await source("server/auth/requireFinanceAccess.ts");
  assert.match(text, /code: "UNAUTHENTICATED", error: "Authentication required"/);
  assert.match(text, /code: "FINANCE_ACCESS_DENIED", error: "Finance access denied"/);
  assert.doesNotMatch(text, /error\.message|error\.status|details|hint/);
});
