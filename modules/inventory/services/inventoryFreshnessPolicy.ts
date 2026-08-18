export function isInventoryTimestampNotStale(
  timestamp: string | null,
  now = new Date(),
): boolean {
  if (!timestamp) return false;
  const ageHours = (now.getTime() - new Date(timestamp).getTime()) / 3_600_000;
  return Number.isFinite(ageHours) && ageHours >= 0 && ageHours <= 72;
}
