import { NextResponse } from "next/server";

export class UnlinkedObligationsApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 422) {
    super(message);
    this.name = "UnlinkedObligationsApiError";
  }
}

const CONFLICT_CODES = new Set([
  "OBLIGATION_NOT_ACTIVE", "OBLIGATION_HAS_ALLOCATIONS", "TEMPLATE_IMMUTABLE",
  "END_DATE_BEFORE_LATEST_OCCURRENCE", "PLAN_REPLACEMENT_REQUIRED",
  "REPLAN_MODE_REQUIRED", "REPLAN_TOTAL_REQUIRED", "REPLAN_INSTALLMENTS_REQUIRED",
  "REPLAN_COMPONENTS_REQUIRED", "IMMUTABLE_TEMPLATE_FREQUENCY", "IMMUTABLE_TEMPLATE_ANCHOR",
]);

const CONTRACT_PREFIXES = [
  "INVALID_", "TOTAL_ONLY_COMPONENTS_FORBIDDEN", "CANCELLATION_REASON_REQUIRED",
  "DUPLICATE_INSTALLMENT_SEQUENCE", "INSTALLMENT_",
];

function extractCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    if (/^[A-Z][A-Z0-9_]+$/.test(error.code)) return error.code;
  }
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/\b([A-Z][A-Z0-9_]{2,})\b/);
  return match?.[1] ?? null;
}

export function mapUnlinkedApiError(error: unknown): { code: string; error: string; status: number } {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "UNAUTHENTICATED") {
      return { code: "UNAUTHENTICATED", error: "Authentication required", status: 401 };
    }
    if (error.code === "FINANCE_ACCESS_DENIED") {
      return { code: "FINANCE_ACCESS_DENIED", error: "Finance access denied", status: 403 };
    }
  }
  if (error instanceof UnlinkedObligationsApiError) return { code: error.code, error: error.message, status: error.status };
  const rawCode = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const code = extractCode(error) ?? "INTERNAL_ERROR";
  if (rawCode === "42501" || code === "ADMIN_OR_ACCOUNTING_REQUIRED" || code === "TREASURY_READ_REQUIRED") {
    return { code: code === "42501" ? "FINANCE_ACCESS_DENIED" : code, error: "Finance access denied", status: 403 };
  }
  if (code === "NOT_FOUND" || rawCode === "PGRST116") return { code: "NOT_FOUND", error: "Resource not found", status: 404 };
  if (CONFLICT_CODES.has(code) || code.includes("CONFLICT") || code.includes("MISMATCH")) {
    return { code, error: "Finance operation conflicts with the current state", status: 409 };
  }
  if (CONTRACT_PREFIXES.some((prefix) => code.startsWith(prefix))) return { code, error: "Invalid finance operation", status: 422 };
  return { code: "INTERNAL_ERROR", error: "Unexpected finance error", status: 500 };
}

export function unlinkedApiErrorResponse(error: unknown) {
  const mapped = mapUnlinkedApiError(error);
  return NextResponse.json({ ok: false, code: mapped.code, error: mapped.error }, { status: mapped.status });
}

export async function readUnlinkedJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new UnlinkedObligationsApiError("INVALID_JSON", "Request body must be a JSON object", 422);
  }
}
