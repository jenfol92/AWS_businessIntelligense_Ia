import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import test from "node:test";

const repositoryUrl = `${pathToFileURL(process.cwd()).href}/`;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/headers") return nextResolve("next/headers.js", context);
  if (specifier.startsWith("@/")) return { shortCircuit: true, url: pathToFileURL(`${process.cwd()}/${specifier.slice(2)}.ts`).href };
  if (context.parentURL?.startsWith(repositoryUrl) && !context.parentURL.includes("/node_modules/") && (specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) return { shortCircuit: true, url: new URL(`${specifier}.ts`, context.parentURL).href };
  return nextResolve(specifier, context);
} });

const { normalizeCreditLineRepaymentV2Input } = await import("./creditLineRepaymentValidation.ts");
const { createCreditLineRepaymentV2 } = await import("./creditLineLedgerService.ts");
const { CreditLineLedgerError } = await import("../types/creditLineLedger.types.ts");

const lineId = "10000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000001";
const cashId = "30000000-0000-4000-8000-000000000001";
const base = {
  repaymentGroupId: groupId,
  cashAccountId: cashId,
  principalPaidEur: 12.3,
  interestPaidEur: 1.25,
  feesPaidEur: 0,
  effectiveDate: "2026-08-04",
  bankReference: " REF-1 ",
  notes: " note ",
  idempotencyKey: " idem-1 ",
};

test("normalizes supported money and never receives a client total", () => {
  const result = normalizeCreditLineRepaymentV2Input(lineId, base);
  assert.equal(result.principalPaidEur, 12.3);
  assert.equal(result.interestPaidEur, 1.25);
  assert.equal(result.feesPaidEur, 0);
  assert.equal(result.bankReference, "REF-1");
  assert.equal(result.idempotencyKey, "idem-1");
  assert.equal("totalCashOutEur" in result, false);
  for (const unsupported of [{ totalCashOutEur: 999 }, { amount: 12.3 }]) {
    assert.throws(
      () => normalizeCreditLineRepaymentV2Input(lineId, { ...base, ...unsupported }),
      (error) => error instanceof CreditLineLedgerError && error.code === "INVALID_AMOUNT",
    );
  }
});

test("rejects more than two decimals, NaN, Infinity and numeric strings", () => {
  for (const value of [1.001, Number.NaN, Number.POSITIVE_INFINITY, "12.34"]) {
    assert.throws(
      () => normalizeCreditLineRepaymentV2Input(lineId, { ...base, principalPaidEur: value }),
      (error) => error instanceof CreditLineLedgerError && error.code === "INVALID_AMOUNT",
    );
  }
});

test("requires at least one positive component", () => {
  assert.throws(
    () => normalizeCreditLineRepaymentV2Input(lineId, {
      ...base, principalPaidEur: 0, interestPaidEur: 0, feesPaidEur: 0,
    }),
    (error) => error instanceof CreditLineLedgerError && error.code === "INVALID_AMOUNT",
  );
});

test("repository uses only finance_create_credit_line_repayment_v2 for the v2 operation", async () => {
  const source = await readFile(path.join(process.cwd(), "modules/finance/repositories/creditLineLedgerRepository.ts"), "utf8");
  const block = source.replace(/\r\n/g, "\n").match(/export async function createCreditLineRepaymentV2Rpc[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(block, /\.rpc\("finance_create_credit_line_repayment_v2"/);
  assert.doesNotMatch(block, /\.rpc\("finance_create_credit_line_repayment"/);
});

test("service sanitizes unknown PostgreSQL messages", async () => {
  const client = { rpc: async () => ({ data: null, error: { message: "secret SQL finance_credit_lines", details: "secret", hint: "secret" } }) };
  await assert.rejects(createCreditLineRepaymentV2(normalizeCreditLineRepaymentV2Input(lineId, base), client), (error) =>
    error instanceof CreditLineLedgerError
      && error.code === "INTERNAL_ERROR"
      && error.message === "No se pudo registrar la devolucion."
      && !/secret|SQL|finance_credit_lines/i.test(error.message));
});

test("service maps GROUP_CLOSED to its stable public message", async () => {
  const client = { rpc: async () => ({
    data: null,
    error: { message: "GROUP_CLOSED: secret SQL repayment group", details: "secret", hint: "secret" },
  }) };
  await assert.rejects(createCreditLineRepaymentV2(normalizeCreditLineRepaymentV2Input(lineId, base), client), (error) =>
    error instanceof CreditLineLedgerError
      && error.code === "GROUP_CLOSED"
      && error.message === "El vencimiento ya no admite devoluciones."
      && !/secret|SQL|repayment group/i.test(error.message));
});

test("service maps PostgreSQL 42501 to the fixed finance denial", async () => {
  const client = { rpc: async () => ({
    data: null,
    error: { code: "42501", message: "secret SQL authorization detail", details: "secret", hint: "secret" },
  }) };
  await assert.rejects(createCreditLineRepaymentV2(normalizeCreditLineRepaymentV2Input(lineId, base), client), (error) =>
    error instanceof CreditLineLedgerError
      && error.code === "ADMIN_OR_ACCOUNTING_REQUIRED"
      && error.message === "Finance access denied");
});

test("out-of-sequence repayments use a stable public message and HTTP 409", async () => {
  const client = { rpc: async () => ({
    data: null,
    error: {
      message: "REPAYMENT_DATE_OUT_OF_SEQUENCE: secret SQL 2026-08-01",
      details: "secret table and UUID",
      hint: "secret",
    },
  }) };
  await assert.rejects(createCreditLineRepaymentV2(normalizeCreditLineRepaymentV2Input(lineId, base), client), (error) =>
    error instanceof CreditLineLedgerError
      && error.code === "REPAYMENT_DATE_OUT_OF_SEQUENCE"
      && error.message === "La fecha efectiva es anterior a la secuencia financiera del vencimiento."
      && !/secret|SQL|2026-08-01|UUID/i.test(error.message));

  const route = await readFile(path.join(process.cwd(), "app/api/finance/credit-lines/[id]/repay/route.ts"), "utf8");
  assert.match(route, /error\.code === "REPAYMENT_DATE_OUT_OF_SEQUENCE"[\s\S]{0,80}\? 409/);
});
