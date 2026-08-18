import { isAwsSigV4Configured, loadSpApiConfig } from "./config";
import { mapHttpSpApiError, mapUpstreamFetchError, SpApiError } from "./errors";
import { clearLwaAccessTokenCache, getLwaAccessToken } from "./lwaClient";
import { signSpApiRequest } from "./signing";
import type { SpApiConfig } from "./config";
import { resolveRateLimitRetryCount, resolveSpApiRetryDelayMs } from "./spApiRetryPolicy";

export type SpApiRequestInput = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
  rateLimitRetry?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
  operation?: string;
  onResponseMetadata?: (metadata: SpApiResponseMetadata) => void;
  /** Disable the otherwise safe LWA-expiry replay for strict one-shot diagnostics. */
  retryExpiredAccessToken?: boolean;
};

export type SpApiResponseMetadata = {
  operation: string;
  status: number;
  observedRateLimit: string | null;
  retryAfter: string | null;
  requestId: string | null;
  observedAt: string;
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

export function buildSpApiUrl(
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
  operation: string;
  onResponseMetadata?: (metadata: SpApiResponseMetadata) => void;
}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });
  } catch (error) {
    throw mapUpstreamFetchError(error, "SP_API", request.url);
  }
  request.onResponseMetadata?.({
    operation: request.operation,
    status: res.status,
    observedRateLimit: res.headers.get("x-amzn-ratelimit-limit"),
    retryAfter: res.headers.get("retry-after"),
    requestId:
      res.headers.get("x-amzn-requestid") ??
      res.headers.get("x-amzn-request-id") ??
      res.headers.get("x-amz-request-id"),
    observedAt: new Date().toISOString(),
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const executableRequest = {
    ...firstRequest,
    operation: input.operation ?? `${input.method} ${input.path}`,
    onResponseMetadata: input.onResponseMetadata,
  };

  try {
    return await executeSpApiRequest<T>(executableRequest);
  } catch (error) {
    if (!(error instanceof SpApiError)) {
      throw error;
    }

    if (error.code === "rate_limited" && input.method === "GET") {
      const maxRetries = resolveRateLimitRetryCount(
        error.details,
        input.rateLimitRetry?.maxRetries ?? 0,
      );
      const baseDelayMs = Math.max(250, input.rateLimitRetry?.baseDelayMs ?? 1_000);
      const maxDelayMs = Math.max(baseDelayMs, input.rateLimitRetry?.maxDelayMs ?? 15_000);
      let lastError = error;
      for (let attempt = 0; attempt < maxRetries; attempt += 1) {
        await sleep(resolveSpApiRetryDelayMs(lastError.details, attempt, baseDelayMs, maxDelayMs));
        try {
          return await executeSpApiRequest<T>(executableRequest);
        } catch (retryError) {
          if (!(retryError instanceof SpApiError) || retryError.code !== "rate_limited") {
            throw retryError;
          }
          lastError = retryError;
        }
      }
      throw withRetryDiagnostic(lastError, {
        spApiRetryAttempted: maxRetries > 0,
        spApiRetryReason: null,
        spApiRetryResult: maxRetries > 0 ? "attempted_failed" : "not_attempted",
        firstTokenExpiresIn: firstToken.expiresIn,
        refreshedTokenExpiresIn: null,
        usedSigV4,
      });
    }

    if (!isExpiredAccessTokenError(error) || input.retryExpiredAccessToken === false) {
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
      const result = await executeSpApiRequest<T>({
        ...retryRequest,
        operation: executableRequest.operation,
        onResponseMetadata: executableRequest.onResponseMetadata,
      });
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
