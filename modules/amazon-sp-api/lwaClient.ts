import type { SpApiConfig } from "./config";
import { mapLwaError } from "./errors";
import type { LwaTokenResponse } from "./types";

const LWA_TOKEN_URL = "https://api.amazon.com/auth/o2/token";

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

let cachedToken: CachedToken | null = null;
const LWA_EXPIRY_SAFETY_MARGIN_SECONDS = 300;

export type LwaAccessTokenResult = {
  accessToken: string;
  expiresIn: number;
  cached: boolean;
};

export function clearLwaTokenCache(): void {
  cachedToken = null;
}

export function clearLwaAccessTokenCache(): void {
  clearLwaTokenCache();
}

export async function getLwaAccessToken(
  config: SpApiConfig,
  options: { forceRefresh?: boolean } = {},
): Promise<LwaAccessTokenResult> {
  const now = Date.now();
  if (!options.forceRefresh && cachedToken && cachedToken.expiresAtMs > now) {
    return {
      accessToken: cachedToken.accessToken,
      expiresIn: Math.floor((cachedToken.expiresAtMs - now) / 1000),
      cached: true,
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
    expiresAtMs:
      now +
      Math.max(json.expires_in - LWA_EXPIRY_SAFETY_MARGIN_SECONDS, 0) * 1000,
  };

  return {
    accessToken: json.access_token,
    expiresIn: Math.max(json.expires_in - LWA_EXPIRY_SAFETY_MARGIN_SECONDS, 0),
    cached: false,
  };
}
