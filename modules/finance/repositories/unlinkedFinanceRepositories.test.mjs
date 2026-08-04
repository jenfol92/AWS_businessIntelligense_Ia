import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
const repositoryUrl = `${pathToFileURL(process.cwd()).href}/`;
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/headers") return nextResolve("next/headers.js", context);
  if (specifier.startsWith("@/")) return { shortCircuit: true, url: pathToFileURL(`${process.cwd()}/${specifier.slice(2)}.ts`).href };
  if (context.parentURL?.startsWith(repositoryUrl) && !context.parentURL.includes("/node_modules/") && (specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) return { shortCircuit: true, url: new URL(`${specifier}.ts`, context.parentURL).href };
  return nextResolve(specifier, context);
} });
const commands = await import("./unlinkedObligationsCommandsRepository.ts");
const { listUnlinkedTreasuryCommitments } = await import("./unlinkedTreasuryRepository.ts");

const uuid = (suffix) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;

test("command repository uses exactly the seven RPCs and never direct tables", async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { ok: true }, error: null }; }, from: () => assert.fail("direct table access") };
  await commands.createUnlinkedObligation(client, {});
  await commands.updatePendingUnlinkedObligation(client, uuid("1"), {});
  await commands.replaceUnpaidInstallmentPlan(client, uuid("1"), {});
  await commands.cancelUnlinkedObligation(client, uuid("1"), "reason");
  await commands.createUnlinkedObligationTemplate(client, {});
  await commands.updateUnlinkedObligationTemplate(client, uuid("2"), {});
  await commands.generateUnlinkedObligationOccurrences(client, uuid("2"), "2026-08-01");
  assert.deepEqual(calls.map((call) => call.name), [
    "finance_create_unlinked_obligation", "finance_update_pending_unlinked_obligation",
    "finance_replace_unpaid_installment_plan", "finance_cancel_unlinked_obligation",
    "finance_create_unlinked_obligation_template", "finance_update_unlinked_obligation_template",
    "finance_generate_unlinked_obligation_occurrences",
  ]);
});

test("treasury calls only its RPC and exposes exactly 13 safe camelCase columns", async () => {
  const row = {
    obligation_id: uuid("1"), installment_id: uuid("2"), template_id: null, origin_type: "one_off",
    concept: "Rent", category: "rent", due_date: "2026-08-10", planned_total_eur: "100.00",
    allocated_total_eur: "25.00", outstanding_total_eur: "75.00", financial_status: "partial",
    temporal_condition: "due_soon", has_overdue_installment: false,
  };
  const client = { rpc: async (name) => ({ data: name === "finance_list_unlinked_treasury_commitments" ? [row] : assert.fail("wrong RPC"), error: null }), from: () => assert.fail("direct table access") };
  const [mapped] = await listUnlinkedTreasuryCommitments(client, null, null);
  assert.equal(Object.keys(mapped).length, 13);
  assert.equal(mapped.outstandingTotalEur, 75);
  assert.equal("description" in mapped, false);
  assert.equal("cashMovementId" in mapped, false);
});
