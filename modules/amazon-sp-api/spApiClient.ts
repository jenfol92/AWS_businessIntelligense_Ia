import { isAwsSigV4Configured, loadSpApiConfig } from "./config";
import { mapHttpSpApiError } from "./errors";
import { getLwaAccessToken } from "./lwaClient";
import { signSpApiRequest } from "./signing";

export type SpApiRequestInput = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string | undefined>;
  body?: unknown;
};

const SP_API_USER_AGENT = "ERP-BI-IA/1.0 (Language=TypeScript)";

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

export async function spApiRequest<T>(input: SpApiRequestInput): Promise<T> {
  const config = loadSpApiConfig();
  const { accessToken } = await getLwaAccessToken(config);
  const bodyString = serializeBody(input.body);

  let url: string;
  let method = input.method.toUpperCase();
  let headers: Record<string, string>;

  if (isAwsSigV4Configured(config)) {
    const signed = await signSpApiRequest({
      config,
      method: input.method,
      path: input.path,
      query: input.query,
      body: input.body,
      accessToken,
    });

    const endpointUrl = new URL(config.endpoint);
    url = `${endpointUrl.origin}${signed.path}`;
    method = signed.method ?? method;
    headers = Object.fromEntries(
      Object.entries(signed.headers ?? {}).map(([k, v]) => [k, String(v)]),
    );
  } else {
    url = buildSpApiUrl(config.endpoint, input.path, input.query);
    headers = {
      "x-amz-access-token": accessToken,
      "user-agent": SP_API_USER_AGENT,
    };
    if (bodyString != null) {
      headers["content-type"] = "application/json";
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: bodyString,
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
    throw mapHttpSpApiError(res.status, json);
  }

  return json as T;
}

export async function checkSpApiHealth(): Promise<{ expiresIn: number }> {
  const config = loadSpApiConfig();
  const { expiresIn } = await getLwaAccessToken(config);
  return { expiresIn };
}
