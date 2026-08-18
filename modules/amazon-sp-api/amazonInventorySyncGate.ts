export const AMAZON_INVENTORY_CANONICAL_FREQUENCY_MINUTES = 240;
export const AMAZON_INVENTORY_RATE_LIMIT_COOLDOWN_MINUTES = 30;
export const AMAZON_INVENTORY_RUNNING_LEASE_MINUTES = 15;

export function resolveCanonicalInventorySyncGate(input: {
  now: Date;
  force?: boolean;
  lastSuccessAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
}): "skipped_fresh" | "skipped_rate_limit" | "skipped_running" | null {
  if (input.lastStatus === "RUNNING" && input.lastRunAt) {
    const ageMs = input.now.getTime() - new Date(input.lastRunAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < AMAZON_INVENTORY_RUNNING_LEASE_MINUTES * 60_000) {
      return "skipped_running";
    }
  }
  if (input.force) return null;
  if (input.lastStatus === "RATE_LIMITED" && input.lastRunAt) {
    const ageMs = input.now.getTime() - new Date(input.lastRunAt).getTime();
    if (Number.isFinite(ageMs) && ageMs < AMAZON_INVENTORY_RATE_LIMIT_COOLDOWN_MINUTES * 60_000) return "skipped_rate_limit";
  }
  if (input.lastSuccessAt) {
    const ageMs = input.now.getTime() - new Date(input.lastSuccessAt).getTime();
    if (Number.isFinite(ageMs) && ageMs < AMAZON_INVENTORY_CANONICAL_FREQUENCY_MINUTES * 60_000) return "skipped_fresh";
  }
  return null;
}
