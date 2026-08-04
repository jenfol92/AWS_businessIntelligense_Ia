import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  canManageUnlinkedObligations,
  canReadTreasury,
  canReadUnlinkedObligationDetails,
  getAppRole,
  type AppRole,
} from "./adminAuthorization";

export class FinanceAccessError extends Error {
  constructor(
    public readonly code: "UNAUTHENTICATED" | "FINANCE_ACCESS_DENIED",
    public readonly status: 401 | 403,
  ) {
    super(code === "UNAUTHENTICATED" ? "Authentication required" : "Finance access denied");
    this.name = "FinanceAccessError";
  }
}

export type FinanceAccessContext = {
  supabase: SupabaseClient;
  user: User;
  role: AppRole;
};

export type FinanceAccessErrorResponse = {
  status: 401 | 403;
  body: {
    ok: false;
    code: "UNAUTHENTICATED" | "FINANCE_ACCESS_DENIED";
    error: "Authentication required" | "Finance access denied";
  };
};

type Capability = (user: User) => boolean;

async function requireAccess(
  capability: Capability,
  injectedClient?: SupabaseClient,
): Promise<FinanceAccessContext> {
  const supabase = injectedClient
    ?? (await import("../supabase/routeClient")).createSupabaseRouteClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new FinanceAccessError("UNAUTHENTICATED", 401);
  const role = getAppRole(data.user);
  if (!role || !capability(data.user)) throw new FinanceAccessError("FINANCE_ACCESS_DENIED", 403);
  return { supabase, user: data.user, role };
}

/** Operational treasury read access for admin, accounting and logistics. */
export function requireTreasuryAccess(supabase?: SupabaseClient) {
  return requireAccess(canReadTreasury, supabase);
}

export function requireUnlinkedDetailsAccess(supabase?: SupabaseClient) {
  return requireAccess(canReadUnlinkedObligationDetails, supabase);
}

export function requireUnlinkedManagementAccess(supabase?: SupabaseClient) {
  return requireAccess(canManageUnlinkedObligations, supabase);
}

/** Financial execution and management are restricted to admin and accounting. */
export function requireFinanceDetailsAccess(supabase?: SupabaseClient) {
  return requireAccess(canReadUnlinkedObligationDetails, supabase);
}

export function getFinanceAccessErrorResponse(error: unknown): FinanceAccessErrorResponse | null {
  const code =
    error instanceof FinanceAccessError
      ? error.code
      : error && typeof error === "object" && "code" in error
        ? (error as { code?: unknown }).code
        : null;

  if (code === "UNAUTHENTICATED") {
    return {
      status: 401,
      body: { ok: false, code: "UNAUTHENTICATED", error: "Authentication required" },
    };
  }
  if (code === "FINANCE_ACCESS_DENIED") {
    return {
      status: 403,
      body: { ok: false, code: "FINANCE_ACCESS_DENIED", error: "Finance access denied" },
    };
  }
  return null;
}
