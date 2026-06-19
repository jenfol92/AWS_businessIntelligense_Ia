import type { SpApiConfig } from "./config";
import { mapLwaError } from "./errors";
import type { LwaTokenResponse } from "./types";

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

let cachedToken: CachedToken | null = null;

export function clearLwaTokenCache(): void {
  cachedToken = null;
}

export async function getLwaAccessToken(
  config: SpApiConfig,
): Promise<{ accessToken: string; expiresIn: number }> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAtMs > now + 60_000) {
    return {
      accessToken: cachedToken.accessToken,
      expiresIn: Math.floor((cachedToken.expiresAtMs - now) / 1000),
    };
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: config.lwaRefreshToken,
    client_id: config.lwaClientId,
    client_secret: config.lwaClientSecret,
  });

  const res = await fetch(LWA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await res.json()) as LwaTokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (!res.ok || json.error) {
    throw mapLwaError(json.error ?? "unknown", json.error_description);
  }

  cachedToken = {
    accessToken: json.access_token,
    expiresAtMs: now + json.expires_in * 1000,
  };

  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in,
  };
}
