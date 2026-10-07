import { loadSpApiConfig, type SpApiConfig } from "./config.ts";
import type { SpApiRequestInput, SpApiResponseMetadata } from "./spApiClient.ts";

export const ALAIA_FBM_ERP_SKU = "8436616610104";
export const ALAIA_FBM_ASIN = "B0DJBQGKBT";
export const ALAIA_FBM_SELLER_SKU = "f8436616610104";
export const AMAZON_ES_MARKETPLACE_ID = "A1RKKUPIHCS9HS";

export type ListingsItemFulfillmentAvailability = {
  fulfillmentChannelCode?: unknown;
  quantity?: unknown;
  [key: string]: unknown;
};

export type ListingsItemApiResponse = {
  sku?: unknown;
  asin?: unknown;
  summaries?: unknown;
  fulfillmentAvailability?: ListingsItemFulfillmentAvailability[];
  [key: string]: unknown;
};

type ValidatedListingsItemApiResponse = ListingsItemApiResponse & {
  asin: string | null;
  fulfillmentAvailability: ListingsItemFulfillmentAvailability[];
};

export type ListingsItemDiagnostic = {
  sellerSku: string;
  marketplaceId: string;
  asin: string | null;
  observedAt: string;
  fulfillmentAvailability: ListingsItemFulfillmentAvailability[] | null;
  mfnQuantity: number | null;
  responseMetadata: SpApiResponseMetadata | null;
  amazonHttpCalls: 1;
  raw: ListingsItemApiResponse;
};

type ListingsItemsRequester = <T>(input: SpApiRequestInput) => Promise<T>;

// Amazon Listings Items v2021-08-01: Item, ItemIssues, Issue, IssueEnforcements.
// https://github.com/amzn/selling-partner-api-models/blob/main/models/listings-items-api-model/listingsItems_2021-08-01.json
// Listings issues are observed listing problems, not proof of legal compliance.
export type AmazonListingIssue = {
  code: string;
  message: string;
  severity: "ERROR" | "WARNING" | "INFO";
  categories: string[];
  attributeNames?: string[];
  marketplaceIds?: string[];
  enforcements?: {
    actions: { action: string }[];
    exemption: { status: string; expiryDate?: string };
  };
};

type ListingIssuesContext = {
  sellerId: string | null;
  sku: string;
  marketplaceId: string;
  checkedAt: string; // Attempt time on failure; never a successful-verification timestamp.
  requestId: string | null;
  amazonResponses: number; // Responses observed by transport, not inferred network attempts.
};

export type ListingIssuesObservation = ListingIssuesContext & (
  | { status: "SUCCESS"; issues: AmazonListingIssue[] }
  | { status: "LISTING_NOT_FOUND" | "RATE_LIMITED" | "UNAUTHORIZED" |
      "QUERY_FAILED" | "INVALID_RESPONSE" | "UNKNOWN"; error: string }
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function readListingIssues(raw: unknown, sku: string, marketplaceId: string): AmazonListingIssue[] | null {
  // Item requires sku. Require an explicit issues array even though it is optional
  // in the schema: an omitted dataset is not evidence of zero issues.
  if (!isRecord(raw) || raw.sku !== sku || !Array.isArray(raw.issues) || "errors" in raw) return null;
  const issues: AmazonListingIssue[] = [];
  for (const value of raw.issues) {
    if (!isRecord(value) || typeof value.code !== "string" || !value.code.trim() ||
        typeof value.message !== "string" || typeof value.severity !== "string" ||
        !["ERROR", "WARNING", "INFO"].includes(String(value.severity)) ||
        !isStringArray(value.categories)) return null;
    for (const key of ["attributeNames", "marketplaceIds"] as const) {
      if (key in value && !isStringArray(value[key])) return null;
    }
    if (isStringArray(value.marketplaceIds) &&
        (value.marketplaceIds.length === 0 || value.marketplaceIds.some((id) => id !== marketplaceId))) return null;
    const issue: AmazonListingIssue = {
      code: value.code, message: value.message,
      severity: value.severity as AmazonListingIssue["severity"],
      categories: [...value.categories],
    };
    if (isStringArray(value.attributeNames)) issue.attributeNames = [...value.attributeNames];
    if (isStringArray(value.marketplaceIds)) issue.marketplaceIds = [...value.marketplaceIds];
    if ("enforcements" in value) {
      const enforcement = value.enforcements;
      if (!isRecord(enforcement) || !Array.isArray(enforcement.actions) ||
          !enforcement.actions.every((action) => isRecord(action) && typeof action.action === "string") ||
          !isRecord(enforcement.exemption) || typeof enforcement.exemption.status !== "string" ||
          ("expiryDate" in enforcement.exemption && typeof enforcement.exemption.expiryDate !== "string")) return null;
      issue.enforcements = {
        actions: enforcement.actions.map((action) => ({ action: action.action as string })),
        exemption: {
          status: enforcement.exemption.status,
          ...(typeof enforcement.exemption.expiryDate === "string" ? { expiryDate: enforcement.exemption.expiryDate } : {}),
        },
      };
    }
    issues.push(issue);
  }
  return issues;
}

export async function getListingIssues(params: {
  sellerSku: string;
  marketplaceId: string;
  signal?: AbortSignal;
  oneShot?: boolean;
  request?: ListingsItemsRequester;
  loadConfig?: () => SpApiConfig;
}): Promise<ListingIssuesObservation> {
  const context: ListingIssuesContext = {
    sellerId: null, sku: params.sellerSku, marketplaceId: params.marketplaceId,
    checkedAt: new Date().toISOString(), requestId: null, amazonResponses: 0,
  };
  const failure = (status: Exclude<ListingIssuesObservation["status"], "SUCCESS">, error: string): ListingIssuesObservation =>
    ({ ...context, checkedAt: new Date().toISOString(), status, error });
  if (!params.sellerSku?.trim() || params.sellerSku !== params.sellerSku.trim() ||
      /[\x00-\x1f\x7f]/.test(params.sellerSku) || !params.marketplaceId?.trim()) {
    return failure("UNKNOWN", "LISTING_IDENTITY_REQUIRED");
  }
  let config: SpApiConfig;
  try {
    config = (params.loadConfig ?? loadSpApiConfig)();
  } catch {
    return failure("UNKNOWN", "SP_API_CONFIGURATION_UNAVAILABLE");
  }
  context.sellerId = config.sellerId ?? null;
  if (!config.sellerId) return failure("UNKNOWN", "AMAZON_SELLER_ID_MISSING");
  try {
    const request = params.request ?? (await import("./spApiClient.ts")).spApiRequest;
    const raw = await request<unknown>({
      method: "GET",
      path: `/listings/2021-08-01/items/${encodeURIComponent(config.sellerId)}/${encodeURIComponent(params.sellerSku)}`,
      query: { marketplaceIds: params.marketplaceId, includedData: "issues" },
      operation: "getListingsItem.issues",
      signal: params.signal,
      rateLimitRetry: { maxRetries: params.oneShot ? 0 : 1, baseDelayMs: 1_500, maxDelayMs: 8_000 },
      retryExpiredAccessToken: !params.oneShot,
      onResponseMetadata(metadata) {
        context.amazonResponses += 1;
        context.requestId = metadata.requestId;
      },
    });
    const issues = readListingIssues(raw, params.sellerSku, params.marketplaceId);
    if (issues === null) return failure("INVALID_RESPONSE", "LISTING_ISSUES_PAYLOAD_INVALID");
    return { ...context, checkedAt: new Date().toISOString(), status: "SUCCESS", issues };
  } catch (error) {
    // Never expose upstream bodies, headers, tokens or arbitrary error messages.
    const status = isRecord(error) ? error.status : undefined;
    if (status === 404) return failure("LISTING_NOT_FOUND", "AMAZON_HTTP_404");
    if (status === 429) return failure("RATE_LIMITED", "AMAZON_HTTP_429");
    if (status === 401 || status === 403) return failure("UNAUTHORIZED", `AMAZON_HTTP_${status}`);
    return failure("QUERY_FAILED", "LISTING_ISSUES_QUERY_FAILED");
  }
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function fail(code: string, sellerSku: string): never {
  throw new Error(`${code}:${sellerSku}`);
}

export function validateFbmListingsItemResponse(
  raw: unknown,
  expected: { sellerSku: string; asin?: string },
): ValidatedListingsItemApiResponse {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail("FBM_LISTINGS_PAYLOAD_INVALID", expected.sellerSku);
  }
  const payload = raw as ListingsItemApiResponse;
  if (payload.sku !== undefined && payload.sku !== expected.sellerSku) {
    fail("FBM_LISTINGS_PAYLOAD_INVALID", expected.sellerSku);
  }
  const directAsin = nonEmptyString(payload.asin);
  const summaries = Array.isArray(payload.summaries) ? payload.summaries : [];
  const summaryAsins = summaries.flatMap((summary) => {
    if (summary === null || typeof summary !== "object" || Array.isArray(summary)) return [];
    const asin = nonEmptyString((summary as Record<string, unknown>).asin);
    return asin ? [asin] : [];
  });
  const observedAsins = [directAsin, ...summaryAsins].filter(
    (asin): asin is string => asin != null,
  );
  if (expected.asin &&
    observedAsins.some(
      (asin) => asin.toUpperCase() !== expected.asin.trim().toUpperCase(),
    )
  ) {
    fail("FBM_LISTINGS_ASIN_INVALID", expected.sellerSku);
  }
  if (!Array.isArray(payload.fulfillmentAvailability)) {
    fail("FBM_LISTINGS_AVAILABILITY_INVALID", expected.sellerSku);
  }
  for (const item of payload.fulfillmentAvailability) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      fail("FBM_LISTINGS_AVAILABILITY_INVALID", expected.sellerSku);
    }
    const channel = nonEmptyString(item.fulfillmentChannelCode);
    if (!channel) fail("FBM_LISTINGS_AVAILABILITY_INVALID", expected.sellerSku);
    if (channel === "DEFAULT" &&
        (!Number.isSafeInteger(item.quantity) || Number(item.quantity) < 0)) {
      fail("FBM_LISTINGS_QUANTITY_INVALID", expected.sellerSku);
    }
  }
  return {
    ...payload,
    asin: observedAsins[0] ?? null,
    fulfillmentAvailability: payload.fulfillmentAvailability,
  };
}

function defaultMfnQuantity(
  availability: ListingsItemFulfillmentAvailability[] | undefined,
): number | null {
  if (!Array.isArray(availability)) return null;
  const defaultChannel = availability.find(
    (row) => row?.fulfillmentChannelCode === "DEFAULT",
  );
  if (!defaultChannel || typeof defaultChannel.quantity !== "number") return null;
  return Number.isFinite(defaultChannel.quantity) ? defaultChannel.quantity : null;
}

export async function getListingsItem(params: {
  sellerSku: string;
  expectedAsin?: string;
  marketplaceId: string;
  request?: ListingsItemsRequester;
  loadConfig?: () => SpApiConfig;
}): Promise<ListingsItemDiagnostic> {
  const sellerSku = params.sellerSku;
  const marketplaceId = params.marketplaceId;
  if (!sellerSku) throw new Error("LISTINGS_ITEM_SELLER_SKU_REQUIRED");
  if (!marketplaceId) throw new Error("LISTINGS_ITEM_MARKETPLACE_ID_REQUIRED");

  const config = (params.loadConfig ?? loadSpApiConfig)();
  if (!config.sellerId) throw new Error("AMAZON_SELLER_ID_MISSING");

  const request = params.request ?? (await import("./spApiClient.ts")).spApiRequest;
  let calls = 0;
  let responseMetadata: SpApiResponseMetadata | null = null;
  const response = await request<unknown>({
    method: "GET",
    path: `/listings/2021-08-01/items/${encodeURIComponent(config.sellerId)}/${encodeURIComponent(sellerSku)}`,
    query: {
      marketplaceIds: marketplaceId,
      includedData: "fulfillmentAvailability,summaries",
    },
    operation: "getListingsItem.fulfillmentAvailabilityDiagnostic",
    rateLimitRetry: { maxRetries: 0 },
    retryExpiredAccessToken: false,
    onResponseMetadata(metadata) {
      calls += 1;
      responseMetadata = metadata;
    },
  });

  // Test requesters do not necessarily emit transport metadata.
  if (calls === 0) calls = 1;
  if (calls !== 1) throw new Error(`LISTINGS_ITEM_REQUEST_LIMIT_EXCEEDED:${calls}`);

  const raw = validateFbmListingsItemResponse(response, {
    sellerSku,
    ...(params.expectedAsin ? { asin: params.expectedAsin } : {}),
  });
  const fulfillmentAvailability = raw.fulfillmentAvailability;
  return {
    sellerSku,
    marketplaceId,
    asin: raw.asin,
    observedAt: responseMetadata?.observedAt ?? new Date().toISOString(),
    fulfillmentAvailability,
    mfnQuantity: defaultMfnQuantity(raw.fulfillmentAvailability),
    responseMetadata,
    amazonHttpCalls: 1,
    raw,
  };
}

export function getAlaiaEsFbmListingsItem(
  dependencies: {
    request?: ListingsItemsRequester;
    loadConfig?: () => SpApiConfig;
  } = {},
): Promise<ListingsItemDiagnostic> {
  return getListingsItem({
    sellerSku: ALAIA_FBM_SELLER_SKU,
    expectedAsin: ALAIA_FBM_ASIN,
    marketplaceId: AMAZON_ES_MARKETPLACE_ID,
    ...dependencies,
  });
}
