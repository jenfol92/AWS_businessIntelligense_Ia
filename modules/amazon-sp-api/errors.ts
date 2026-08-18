export type SpApiErrorCode =
  | "missing_env"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "server_error"
  | "upstream_fetch_failed"
  | "unknown";

export type SpApiFetchFailureLayer = "LWA" | "SP_API";
export type SpApiNetworkFailureKind =
  | "DNS"
  | "TLS"
  | "ECONNRESET"
  | "ECONNREFUSED"
  | "TIMEOUT"
  | "PROXY"
  | "NETWORK_UNAVAILABLE"
  | "OTHER";

export class SpApiError extends Error {
  readonly code: SpApiErrorCode;
  readonly status?: number;
  readonly details?: unknown;

  constructor(
    message: string,
    code: SpApiErrorCode = "unknown",
    status?: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "SpApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function mapLwaError(error: string, description?: string): SpApiError {
  const desc = description ?? error;
  if (error === "invalid_client") {
    return new SpApiError(
      "invalid_client: revisa AMAZON_LWA_CLIENT_ID y AMAZON_LWA_CLIENT_SECRET.",
      "invalid_client",
      401,
    );
  }
  if (error === "invalid_grant") {
    return new SpApiError(
      "invalid_grant: el refresh token no es válido o ha expirado.",
      "invalid_grant",
      401,
    );
  }
  return new SpApiError(desc || error, "unknown", 401);
}

function readAmazonError(body: unknown): {
  code: string;
  message: string;
  details: string;
} {
  if (
    typeof body === "object" &&
    body !== null &&
    "errors" in body &&
    Array.isArray((body as { errors: unknown[] }).errors)
  ) {
    const first = (
      body as { errors: Array<{ code?: unknown; message?: unknown; details?: unknown }> }
    ).errors[0];
    return {
      code: String(first?.code ?? ""),
      message: String(first?.message ?? ""),
      details: String(first?.details ?? ""),
    };
  }

  return { code: "", message: "", details: "" };
}

function enrichErrorDetails(
  body: unknown,
  headers?: Record<string, string>,
): unknown {
  const requestId =
    headers?.["x-amzn-requestid"] ??
    headers?.["x-amzn-request-id"] ??
    headers?.["x-amz-request-id"] ??
    null;

  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return {
      ...(body as Record<string, unknown>),
      headers: headers ?? {},
      requestId,
    };
  }

  return {
    raw: body,
    headers: headers ?? {},
    requestId,
  };
}

export function mapHttpSpApiError(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): SpApiError {
  const amazonError = readAmazonError(body);
  const message = amazonError.message || `SP-API HTTP ${status}`;
  const details = enrichErrorDetails(body, headers);

  if (status === 401) {
    return new SpApiError(message || "No autorizado SP-API.", "unauthorized", 401, details);
  }
  if (status === 403) {
    return new SpApiError(message || "Acceso denegado SP-API.", "forbidden", 403, details);
  }
  if (status === 429) {
    return new SpApiError(
      message || "Rate limit SP-API. Reintenta más tarde.",
      "rate_limited",
      429,
      details,
    );
  }
  if (status >= 500) {
    return new SpApiError(message || "Error interno SP-API.", "server_error", status, details);
  }
  return new SpApiError(message || "Error SP-API.", "unknown", status, details);
}

export function mapGenericError(error: unknown): SpApiError {
  if (error instanceof SpApiError) return error;

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Faltan credenciales SP-API")) {
    return new SpApiError(message, "missing_env");
  }

  return new SpApiError(message, "unknown");
}

function safeCauseField(cause: Record<string, unknown>, key: string): string | number | null {
  const value = cause[key];
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function classifyNetworkFailure(code: string, message: string): SpApiNetworkFailureKind {
  const value = `${code} ${message}`.toUpperCase();
  if (/ENOTFOUND|EAI_AGAIN|DNS/.test(value)) return "DNS";
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS/.test(value)) return "TLS";
  if (/ECONNRESET|UND_ERR_SOCKET/.test(value)) return "ECONNRESET";
  if (/ECONNREFUSED/.test(value)) return "ECONNREFUSED";
  if (/TIMEOUT|TIMEDOUT|ABORT_ERR|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/.test(value)) return "TIMEOUT";
  if (/PROXY/.test(value)) return "PROXY";
  if (/ENETUNREACH|EHOSTUNREACH|ENETDOWN/.test(value)) return "NETWORK_UNAVAILABLE";
  return "OTHER";
}

/** Converts native fetch failures into a safe, stage-aware error without serializing secrets. */
export function mapUpstreamFetchError(
  error: unknown,
  layer: SpApiFetchFailureLayer,
  targetUrl: string,
): SpApiError {
  if (error instanceof SpApiError) return error;
  const candidate = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : {};
  const cause = typeof candidate.cause === "object" && candidate.cause !== null
    ? candidate.cause as Record<string, unknown>
    : {};
  const message = error instanceof Error ? error.message : String(error);
  const code = String(safeCauseField(cause, "code") ?? safeCauseField(candidate, "code") ?? "");
  let targetHostname: string | null = null;
  try {
    targetHostname = new URL(targetUrl).hostname;
  } catch {
    // The request builder validates URLs before reaching fetch.
  }
  return new SpApiError(
    "Upstream fetch failed.",
    "upstream_fetch_failed",
    502,
    {
      upstream: {
        layer,
        kind: classifyNetworkFailure(code, message),
        code: code || null,
        errno: safeCauseField(cause, "errno"),
        syscall: safeCauseField(cause, "syscall"),
        hostname: safeCauseField(cause, "hostname") ?? targetHostname,
        address: safeCauseField(cause, "address"),
        port: safeCauseField(cause, "port"),
      },
    },
  );
}

export function safeSpApiErrorMetadata(error: unknown): {
  code: SpApiErrorCode;
  httpStatus: number | null;
  amazonCode: string | null;
  amazonMessage: string;
  requestId: string | null;
  retryAfter: string | null;
  observedRateLimit: string | null;
  failureLayer: SpApiFetchFailureLayer | null;
  network: Record<string, unknown> | null;
} {
  const mapped = mapGenericError(error);
  const details = typeof mapped.details === "object" && mapped.details !== null
    ? mapped.details as Record<string, unknown>
    : {};
  const headers = typeof details.headers === "object" && details.headers !== null
    ? details.headers as Record<string, unknown>
    : {};
  const errors = Array.isArray(details.errors) ? details.errors : [];
  const first = typeof errors[0] === "object" && errors[0] !== null
    ? errors[0] as Record<string, unknown>
    : {};
  const upstream = typeof details.upstream === "object" && details.upstream !== null
    ? details.upstream as Record<string, unknown>
    : null;
  return {
    code: mapped.code,
    httpStatus: mapped.status ?? null,
    amazonCode: first.code == null ? null : String(first.code),
    amazonMessage: first.message == null ? mapped.message : String(first.message),
    requestId: details.requestId == null ? null : String(details.requestId),
    retryAfter: headers["retry-after"] == null ? null : String(headers["retry-after"]),
    observedRateLimit: headers["x-amzn-ratelimit-limit"] == null
      ? null
      : String(headers["x-amzn-ratelimit-limit"]),
    failureLayer: upstream?.layer === "LWA" || upstream?.layer === "SP_API"
      ? upstream.layer
      : null,
    network: upstream,
  };
}
