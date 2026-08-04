import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  return nextResolve(specifier, context);
} });
const { mapUnlinkedApiError, UnlinkedObligationsApiError } = await import("./unlinkedObligationsApiErrors.ts");

test("database authorization, not found, conflict and contract errors map stably", () => {
  assert.equal(mapUnlinkedApiError({ code: "42501", message: "denied" }).status, 403);
  assert.equal(mapUnlinkedApiError(new Error("NOT_FOUND: missing")).status, 404);
  assert.equal(mapUnlinkedApiError(new Error("OBLIGATION_HAS_ALLOCATIONS")).status, 409);
  assert.equal(mapUnlinkedApiError(new Error("INVALID_COMPONENTS")).status, 422);
  assert.equal(mapUnlinkedApiError(new Error("database internals")).status, 500);
});

test("API validation errors preserve their public code", () => {
  assert.deepEqual(mapUnlinkedApiError(new UnlinkedObligationsApiError("INVALID_DATE", "bad date")), {
    code: "INVALID_DATE", error: "bad date", status: 422,
  });
});

test("repository and PostgreSQL messages are sanitized", () => {
  const conflict = mapUnlinkedApiError({
    code: "OBLIGATION_HAS_ALLOCATIONS",
    message: "secret SQL table finance_unlinked payload 10000000-0000-4000-8000-000000000001",
    details: "private details",
    hint: "private hint",
  });
  assert.deepEqual(conflict, {
    code: "OBLIGATION_HAS_ALLOCATIONS",
    error: "Finance operation conflicts with the current state",
    status: 409,
  });
  assert.doesNotMatch(conflict.error, /secret|SQL|finance_unlinked|payload/i);
  const contract = mapUnlinkedApiError({
    code: "INVALID_COMPONENTS",
    message: "secret SQL payload and internal UUID",
  });
  assert.deepEqual(contract, {
    code: "INVALID_COMPONENTS",
    error: "Invalid finance operation",
    status: 422,
  });
  assert.doesNotMatch(contract.error, /secret|SQL|payload|UUID/i);
});

test("authentication codes ignore external status and messages", () => {
  const unauthenticated = mapUnlinkedApiError({
    code: "UNAUTHENTICATED",
    status: 500,
    message: "secret SQL unauthenticated",
    details: "secret details",
    hint: "secret hint",
  });
  assert.deepEqual(unauthenticated, {
    code: "UNAUTHENTICATED",
    error: "Authentication required",
    status: 401,
  });
  const denied = mapUnlinkedApiError({
    code: "FINANCE_ACCESS_DENIED",
    status: 200,
    message: "secret SQL finance access",
    details: "secret details",
    hint: "secret hint",
  });
  assert.deepEqual(denied, {
    code: "FINANCE_ACCESS_DENIED",
    error: "Finance access denied",
    status: 403,
  });
  assert.doesNotMatch(unauthenticated.error, /secret|SQL/i);
  assert.doesNotMatch(denied.error, /secret|SQL/i);
});
