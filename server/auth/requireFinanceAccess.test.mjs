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
  getFinanceAccessErrorResponse,
  requireFinanceDetailsAccess,
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

test("treasury read accepts logistics, accounting and admin", async () => {
  for (const role of ["logistics", "accounting", " ADMIN "]) {
    const sessionClient = client(user(role));
    const context = await requireTreasuryAccess(sessionClient);
    assert.equal(context.role, role.trim().toLowerCase());
    assert.equal(context.supabase, sessionClient);
  }
});

test("detailed finance access accepts admin/accounting and rejects logistics", async () => {
  await assert.rejects(requireFinanceDetailsAccess(client(user("logistics"))), (error) =>
    error instanceof FinanceAccessError && error.code === "FINANCE_ACCESS_DENIED" && error.status === 403);
  assert.equal((await requireFinanceDetailsAccess(client(user("accounting")))).role, "accounting");
  assert.equal((await requireFinanceDetailsAccess(client(user(" ADMIN ")))).role, "admin");
});

test("finance access responses ignore external status and messages", () => {
  assert.deepEqual(
    getFinanceAccessErrorResponse({ code: "UNAUTHENTICATED", status: 500, message: "secret SQL" }),
    { status: 401, body: { ok: false, code: "UNAUTHENTICATED", error: "Authentication required" } },
  );
  assert.deepEqual(
    getFinanceAccessErrorResponse({ code: "FINANCE_ACCESS_DENIED", status: 200, message: "secret SQL" }),
    { status: 403, body: { ok: false, code: "FINANCE_ACCESS_DENIED", error: "Finance access denied" } },
  );
});
