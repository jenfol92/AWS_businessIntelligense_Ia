/**
 * Diagnóstico seguro de autenticación Google Drive (sin exponer secretos).
 */

export const DRIVE_REFRESH_TOKEN_EXPIRED_MESSAGE =
  "La conexión con Google Drive ha caducado. Genera un nuevo refresh token.";

export const DRIVE_REQUIRED_ENV_VARS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_DRIVE_FOLDER_ID",
  "GOOGLE_DRIVE_ADMIN_REFRESH_TOKEN",
] as const;

export type DriveRequiredEnvVar = (typeof DRIVE_REQUIRED_ENV_VARS)[number];

export function getMissingDriveEnvVars(): DriveRequiredEnvVar[] {
  return DRIVE_REQUIRED_ENV_VARS.filter((name) => !(process.env[name] ?? "").trim());
}

export function logMissingDriveEnvVars(context: string): void {
  const missing = getMissingDriveEnvVars();
  if (missing.length === 0) return;

  console.error(
    `[google-drive] ${context}: faltan variables de entorno: ${missing.join(", ")}`,
  );
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function extractErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;

  if ("code" in error && (error as { code: unknown }).code != null) {
    return String((error as { code: unknown }).code);
  }

  const response = (error as { response?: { data?: { error?: unknown } } }).response;
  const dataError = response?.data?.error;
  if (typeof dataError === "string") return dataError;
  if (typeof dataError === "object" && dataError !== null && "message" in dataError) {
    return String((dataError as { message: unknown }).message);
  }

  return null;
}

/** Google rechazó el refresh token (caducado, revocado o emitido con otro client). */
export function isInvalidGrantError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();
  const code = (extractErrorCode(error) ?? "").toLowerCase();

  return message.includes("invalid_grant") || code === "invalid_grant";
}

/**
 * Log server-side sin imprimir tokens ni valores de variables.
 */
export function logDriveAuthError(context: string, error: unknown): void {
  const missing = getMissingDriveEnvVars();
  if (missing.length > 0) {
    logMissingDriveEnvVars(context);
    return;
  }

  if (isInvalidGrantError(error)) {
    console.error(
      `[google-drive] ${context}: Google rechazó el refresh token (invalid_grant). Regenera GOOGLE_DRIVE_ADMIN_REFRESH_TOKEN.`,
    );
    return;
  }

  console.error(`[google-drive] ${context}: ${extractErrorMessage(error)}`);
}

/** Mensaje seguro para API/UI a partir del error de Google OAuth. */
export function toDriveUserError(error: unknown): Error {
  if (isInvalidGrantError(error)) {
    return new Error(DRIVE_REFRESH_TOKEN_EXPIRED_MESSAGE);
  }

  if (error instanceof Error) return error;
  return new Error(extractErrorMessage(error));
}
