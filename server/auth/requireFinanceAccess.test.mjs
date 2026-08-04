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

const {
  FinanceAccessError,
  requireTreasuryAccess,
  requireUnlinkedManagementAccess,
} = await import("./requireFinanceAccess.ts");

const client = (user, error = null) => ({ auth: { getUser: async () => ({ data: { user }, error }) } });
const user = (role) => ({ id: "10000000-0000-4000-8000-000000000001", app_metadata: { role } });

test("missing session is 401", async () => {
  await assert.rejects(requireUnlinkedManagementAccess(client(null)), (error) =>
    error instanceof FinanceAccessError && error.code === "UNAUTHENTICATED" && error.status === 401);
});

test("management role matrix rejects logistics and accepts accounting/admin", async () => {
  await assert.rejects(requireUnlinkedManagementAccess(client(user("logistics"))), (error) =>
    error instanceof FinanceAccessError && error.code === "FINANCE_ACCESS_DENIED" && error.status === 403);
  assert.equal((await requireUnlinkedManagementAccess(client(user("accounting")))).role, "accounting");
  assert.equal((await requireUnlinkedManagementAccess(client(user("admin")))).role, "admin");
});

test("logistics can use treasury with the injected session client", async () => {
  const sessionClient = client(user("logistics"));
  const context = await requireTreasuryAccess(sessionClient);
  assert.equal(context.role, "logistics");
  assert.equal(context.supabase, sessionClient);
});
