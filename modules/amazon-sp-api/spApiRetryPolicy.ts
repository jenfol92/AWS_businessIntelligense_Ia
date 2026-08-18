export function resolveSpApiRetryDelayMs(
  details: unknown,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const value = details as { headers?: Record<string, string> } | null;
  const raw = value?.headers?.["retry-after"];
  const retryAfterSeconds = raw == null ? Number.NaN : Number(raw);
  const requested = Number.isFinite(retryAfterSeconds)
    ? retryAfterSeconds * 1000
    : baseDelayMs * 2 ** attempt;
  return Math.max(0, Math.min(requested, maxDelayMs));
}

export function resolveRateLimitRetryCount(
  details: unknown,
  requestedRetries: number,
): number {
  const value = details as { headers?: Record<string, string> } | null;
  return value?.headers?.["retry-after"]
    ? Math.max(0, Math.min(requestedRetries, 1))
    : 0;
}
