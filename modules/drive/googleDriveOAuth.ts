/**
 * Módulo   : drive
 * Archivo  : modules/drive/googleDriveOAuth.ts
 * Qué hace : Crea clientes autenticados de Google Drive usando OAuth2.
 *            Portado de bussines/lib/googleDriveOAuth.ts.
 *
 * Variables de entorno requeridas:
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *
 * Para el cliente de administración (server-to-server):
 *   GOOGLE_DRIVE_ADMIN_REFRESH_TOKEN
 */

import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import {
  logDriveAuthError,
  logMissingDriveEnvVars,
  toDriveUserError,
} from "./googleDriveAuthDiagnostics";

/** Tipo público del cliente de Drive. */
export type DriveClient = drive_v3.Drive;

type GoogleTokenInput = {
  accessToken:    string;
  refreshToken?:  string | null;
  /** Segundos desde epoch (como los provee NextAuth account.expires_at). */
  expiresAt?:     number | null;
};

// ─── Helpers privados ─────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    logMissingDriveEnvVars(`requireEnv(${name})`);
    throw new Error(`Falta variable de entorno: ${name}`);
  }
  return v.trim();
}

function shouldRefresh(expiresAt?: number | null): boolean {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt * 1000 - 60_000;
}

// ─── Funciones públicas ───────────────────────────────────────────────────────

/**
 * Crea un cliente Drive para el usuario actual.
 * Si el access token está próximo a expirar y hay refresh token, lo renueva.
 */
export async function getUserDriveClient(tokens: GoogleTokenInput): Promise<{
  drive:       DriveClient;
  accessToken: string;
}> {
  const oauth2 = new google.auth.OAuth2(requireEnv("GOOGLE_CLIENT_ID"), requireEnv("GOOGLE_CLIENT_SECRET"));
  oauth2.setCredentials({
    access_token:  tokens.accessToken,
    refresh_token: tokens.refreshToken ?? undefined,
  });

  let accessToken = tokens.accessToken;
  if (shouldRefresh(tokens.expiresAt) && tokens.refreshToken) {
    try {
      const res = await oauth2.getAccessToken();
      const next = typeof res === "string" ? res : res?.token;
      if (next) {
        accessToken = next;
        oauth2.setCredentials({ access_token: accessToken, refresh_token: tokens.refreshToken });
      }
    } catch (error) {
      logDriveAuthError("getUserDriveClient/getAccessToken", error);
      throw toDriveUserError(error);
    }
  }

  return { drive: google.drive({ version: "v3", auth: oauth2 }), accessToken };
}

/**
 * Crea un cliente Drive usando solo un refresh token (flujo server-to-server).
 * Útil para operaciones de administración sin sesión de usuario activa.
 */
export async function getDriveClientFromRefreshToken(refreshToken: string): Promise<{
  drive:       DriveClient;
  accessToken: string;
}> {
  const oauth2 = new google.auth.OAuth2(requireEnv("GOOGLE_CLIENT_ID"), requireEnv("GOOGLE_CLIENT_SECRET"));
  oauth2.setCredentials({ refresh_token: refreshToken });

  let accessToken: string | null | undefined;
  try {
    const res = await oauth2.getAccessToken();
    accessToken = typeof res === "string" ? res : res?.token;
  } catch (error) {
    logDriveAuthError("getDriveClientFromRefreshToken/getAccessToken", error);
    throw toDriveUserError(error);
  }

  if (!accessToken) {
    logDriveAuthError(
      "getDriveClientFromRefreshToken/getAccessToken",
      new Error("Respuesta vacía al renovar access token"),
    );
    throw new Error("No se pudo obtener access token desde refresh_token");
  }

  oauth2.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  return { drive: google.drive({ version: "v3", auth: oauth2 }), accessToken };
}

/**
 * Crea el cliente Drive de administración usando GOOGLE_DRIVE_ADMIN_REFRESH_TOKEN.
 */
export async function getAdminDriveClient(): Promise<{
  drive:       DriveClient;
  accessToken: string;
}> {
  const refreshToken = requireEnv("GOOGLE_DRIVE_ADMIN_REFRESH_TOKEN").trim();
  return getDriveClientFromRefreshToken(refreshToken);
}
