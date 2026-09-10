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
