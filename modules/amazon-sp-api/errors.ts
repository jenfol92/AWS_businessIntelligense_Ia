export type SpApiErrorCode =
  | "missing_env"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "server_error"
  | "unknown";

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

export function mapHttpSpApiError(status: number, body: unknown): SpApiError {
  const message =
    typeof body === "object" &&
    body !== null &&
    "errors" in body &&
    Array.isArray((body as { errors: unknown[] }).errors)
      ? String((body as { errors: { message?: string }[] }).errors[0]?.message ?? "")
      : `SP-API HTTP ${status}`;

  if (status === 401) {
    return new SpApiError(message || "No autorizado SP-API.", "unauthorized", 401, body);
  }
  if (status === 403) {
    return new SpApiError(message || "Acceso denegado SP-API.", "forbidden", 403, body);
  }
  if (status === 429) {
    return new SpApiError(
      message || "Rate limit SP-API. Reintenta más tarde.",
      "rate_limited",
      429,
      body,
    );
  }
  if (status >= 500) {
    return new SpApiError(message || "Error interno SP-API.", "server_error", status, body);
  }
  return new SpApiError(message || "Error SP-API.", "unknown", status, body);
}

export function mapGenericError(error: unknown): SpApiError {
  if (error instanceof SpApiError) return error;

  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("Faltan credenciales SP-API")) {
    return new SpApiError(message, "missing_env");
  }

  return new SpApiError(message, "unknown");
}
