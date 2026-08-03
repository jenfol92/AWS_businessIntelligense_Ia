export type AppRole = "admin" | "accounting" | "logistics";

type AuthUserLike = {
  app_metadata?: Record<string, unknown> | null;
};

const APP_ROLES: ReadonlySet<string> = new Set([
  "admin",
  "accounting",
  "logistics",
]);

export function getAppRole(user: AuthUserLike | null | undefined): AppRole | null {
  const rawRole = user?.app_metadata?.role;
  if (typeof rawRole !== "string") return null;

  const role = rawRole.trim().toLowerCase();
  return APP_ROLES.has(role) ? (role as AppRole) : null;
}

export function isAdminUser(user: AuthUserLike | null | undefined): boolean {
  return getAppRole(user) === "admin";
}

export function canReadTreasury(user: AuthUserLike | null | undefined): boolean {
  return getAppRole(user) !== null;
}

export function canReadUnlinkedObligationDetails(user: AuthUserLike | null | undefined): boolean {
  const role = getAppRole(user);
  return role === "admin" || role === "accounting";
}

export function canManageUnlinkedObligations(user: AuthUserLike | null | undefined): boolean {
  return canReadUnlinkedObligationDetails(user);
}
