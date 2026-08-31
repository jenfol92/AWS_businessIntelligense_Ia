/**
 * Temporary inbound-sync error instrumentation.
 * Identifies the SP-API origin of HTTP 429 without logging secrets.
 */
import { mapGenericError, safeSpApiErrorMetadata, SpApiError } from "./errors.ts";

const RATE_LIMIT_HEADER_KEYS = [
  "retry-after",
  "x-amzn-ratelimit-limit",
  "x-amzn-ratelimit-remaining",
] as const;

export type InboundSpApiFailureLog = {
  api: string | null;
  operation: string | null;
  httpStatus: number | null;
  amazonCode: string | null;
  amazonMessage: string | null;
  requestId: string | null;
  retryAfter: string | null;
  rateLimitHeaders: Record<string, string>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonempty(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

export function inferInboundApiFromPath(path: string | null | undefined): string | null {
  const value = path ?? "";
  if (value.includes("/inbound/fba/2024-03-20/")) return "fulfillment-inbound-v2024-03-20";
  if (value.includes("/fba/inbound/v0/")) return "fulfillment-inbound-v0";
  return null;
}

export function pickSafeRateLimitHeaders(
  headers: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const source = headers ?? {};
  const picked: Record<string, string> = {};
  for (const key of RATE_LIMIT_HEADER_KEYS) {
    const value = nonempty(source[key]);
    if (value) picked[key] = value;
  }
  return picked;
}

export function buildInboundSpApiFailureLog(
  error: unknown,
  fallback?: { api?: string | null; operation?: string | null },
): InboundSpApiFailureLog {
  const mapped = mapGenericError(error);
  const meta = safeSpApiErrorMetadata(error);
  const details = asRecord(mapped.details);
  const headers = asRecord(details.headers);
  const path = nonempty(details.path);
  const operation =
    nonempty(details.operation) ??
    nonempty(fallback?.operation) ??
    (path && nonempty(details.method) ? `${String(details.method).toUpperCase()} ${path}` : path);
  const api = inferInboundApiFromPath(path) ?? nonempty(fallback?.api);

  return {
    api,
    operation,
    httpStatus: meta.httpStatus,
    amazonCode: nonempty(meta.amazonCode),
    amazonMessage: nonempty(meta.amazonMessage) ?? nonempty(mapped.message),
    requestId: nonempty(meta.requestId),
    retryAfter: nonempty(meta.retryAfter) ?? nonempty(headers["retry-after"]),
    rateLimitHeaders: pickSafeRateLimitHeaders(headers),
  };
}

export function logInboundSpApiFailure(
  error: unknown,
  fallback?: { api?: string | null; operation?: string | null },
): InboundSpApiFailureLog {
  const log = buildInboundSpApiFailureLog(error, fallback);
  console.warn(
    "[inbound-sync][sp-api-error]",
    JSON.stringify({
      api: log.api,
      operation: log.operation,
      httpStatus: log.httpStatus,
      amazonCode: log.amazonCode,
      amazonMessage: log.amazonMessage,
      requestId: log.requestId,
      retryAfter: log.retryAfter,
      rateLimitHeaders: log.rateLimitHeaders,
    }),
  );
  return log;
}

export function buildInboundSyncFailureResponse(error: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  const mapped = mapGenericError(error);
  const log = buildInboundSpApiFailureLog(error);
  const status = mapped.status ?? 400;
  const body: Record<string, unknown> = {
    ok: false,
    error: mapped.message,
    code: mapped.code,
  };

  if (status === 429) {
    body.status = 429;
    if (log.api) body.api = log.api;
    if (log.operation) body.operation = log.operation;
    if (log.amazonCode) body.amazonCode = log.amazonCode;
    if (log.requestId) body.requestId = log.requestId;
    if (log.retryAfter) body.retryAfter = log.retryAfter;
  }

  return { status, body };
}

export function attachSpApiRequestContext(
  error: SpApiError,
  request: { url: string; method: string; operation: string },
): SpApiError {
  let path: string | null = null;
  try {
    path = new URL(request.url).pathname;
  } catch {
    path = nonempty(request.operation);
  }
  const details = asRecord(error.details);
  return new SpApiError(error.message, error.code, error.status, {
    ...details,
    operation: nonempty(request.operation) ?? details.operation ?? null,
    method: nonempty(request.method),
    path,
  });
}
