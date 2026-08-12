import { isAwsSigV4Configured, loadSpApiConfig } from "./config";
import { mapHttpSpApiError, SpApiError } from "./errors";
import { clearLwaAccessTokenCache, getLwaAccessToken } from "./lwaClient";
import { signSpApiRequest } from "./signing";
import type { SpApiConfig } from "./config";

export type SpApiRequestInput = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
};

const SP_API_USER_AGENT = "ERP-BI-IA/1.0 (Language=TypeScript)";

type SpApiRetryDiagnostic = {
  spApiRetryAttempted: boolean;
  spApiRetryReason: "expired_access_token" | null;
  spApiRetryResult:
    | "not_attempted"
    | "attempted_failed"
    | "attempted_succeeded";
  firstTokenExpiresIn: number | null;
  refreshedTokenExpiresIn: number | null;
  usedSigV4: boolean;
};

function buildSpApiUrl(
  endpoint: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, endpoint);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value != null && value !== "") {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

function serializeBody(body: unknown): string | undefined {
  if (body == null) return undefined;
  return typeof body === "string" ? body : JSON.stringify(body);
}

async function buildRequestInit(params: {
  config: SpApiConfig;
  input: SpApiRequestInput;
  accessToken: string;
  bodyString: string | undefined;
}): Promise<{
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}> {
  let url: string;
  let method = params.input.method.toUpperCase();
  let headers: Record<string, string>;

  if (isAwsSigV4Configured(params.config)) {
    const signed = await signSpApiRequest({
      config: params.config,
      method: params.input.method,
      path: params.input.path,
      query: params.input.query,
      body: params.input.body,
      accessToken: params.accessToken,
    });

    const endpointUrl = new URL(params.config.endpoint);
    url = `${endpointUrl.origin}${signed.path}`;
    method = signed.method ?? method;
    headers = Object.fromEntries(
      Object.entries(signed.headers ?? {}).map(([k, v]) => [k, String(v)]),
    );
  } else {
    url = buildSpApiUrl(params.config.endpoint, params.input.path, params.input.query);
    headers = {
      "x-amz-access-token": params.accessToken,
      "user-agent": SP_API_USER_AGENT,
    };
    if (params.bodyString != null) {
      headers["content-type"] = "application/json";
    }
  }

  return { url, method, headers, body: params.bodyString };
}

function stringifyForSearch(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isExpiredAccessTokenError(error: SpApiError): boolean {
  const haystack = `${error.message} ${stringifyForSearch(error.details)}`.toLowerCase();
  return (
    haystack.includes("access token you provided has expired") ||
    haystack.includes("access token expired")
  );
}

function detailsWithDiagnostic(
  details: unknown,
  diagnostic: SpApiRetryDiagnostic,
): unknown {
  if (typeof details === "object" && details !== null && !Array.isArray(details)) {
    return {
      ...(details as Record<string, unknown>),
      diagnostic,
    };
  }

  return {
    raw: details ?? null,
    diagnostic,
  };
}

function withRetryDiagnostic(
  error: SpApiError,
  diagnostic: SpApiRetryDiagnostic,
): SpApiError {
  return new SpApiError(
    error.message,
    error.code,
    error.status,
    detailsWithDiagnostic(error.details, diagnostic),
  );
}

async function executeSpApiRequest<T>(request: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}): Promise<T> {
  const res = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }

  if (!res.ok) {
    throw mapHttpSpApiError(res.status, json, Object.fromEntries(res.headers.entries()));
  }

  return json as T;
}

export async function spApiRequest<T>(input: SpApiRequestInput): Promise<T> {
  const config = loadSpApiConfig();
  const bodyString = serializeBody(input.body);
  const usedSigV4 = isAwsSigV4Configured(config);
  const firstToken = await getLwaAccessToken(config);
  const firstRequest = await buildRequestInit({
    config,
    input,
    accessToken: firstToken.accessToken,
    bodyString,
  });

  try {
    return await executeSpApiRequest<T>(firstRequest);
  } catch (error) {
    if (!(error instanceof SpApiError)) {
      throw error;
    }

    if (!isExpiredAccessTokenError(error)) {
      throw withRetryDiagnostic(error, {
        spApiRetryAttempted: false,
        spApiRetryReason: null,
        spApiRetryResult: "not_attempted",
        firstTokenExpiresIn: firstToken.expiresIn,
        refreshedTokenExpiresIn: null,
        usedSigV4,
      });
    }

    let refreshedTokenExpiresIn: number | null = null;
    try {
      clearLwaAccessTokenCache();
      const refreshedToken = await getLwaAccessToken(config, { forceRefresh: true });
      refreshedTokenExpiresIn = refreshedToken.expiresIn;
      const retryRequest = await buildRequestInit({
        config,
        input,
        accessToken: refreshedToken.accessToken,
        bodyString,
      });
      const result = await executeSpApiRequest<T>(retryRequest);
      return result;
    } catch (retryError) {
      if (retryError instanceof SpApiError) {
        throw withRetryDiagnostic(retryError, {
          spApiRetryAttempted: true,
          spApiRetryReason: "expired_access_token",
          spApiRetryResult: "attempted_failed",
          firstTokenExpiresIn: firstToken.expiresIn,
          refreshedTokenExpiresIn,
          usedSigV4,
        });
      }
      throw retryError;
    }
  }
}

export async function checkSpApiHealth(): Promise<{ expiresIn: number }> {
  const config = loadSpApiConfig();
  const { expiresIn } = await getLwaAccessToken(config);
  return { expiresIn };
}
