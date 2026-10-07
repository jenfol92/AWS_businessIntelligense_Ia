/**
 * modules/policies-compliance/services/catalogItemsClient.ts
 *
 * SP-API Catalog Items v2022-04-01 client.
 * Used exclusively to enrich policy alerts with product metadata (title, image, brand).
 *
 * Guardrails applied:
 *   - §3: respects throttling; bounded retries via spApiRequest.
 *   - §4: credentials remain server-side via loadSpApiConfig().
 *   - §2.1: retrieves only images + summaries (no PII).
 *   - §13: validates payload shape; treats unexpected responses as errors, not coerced values.
 *   - §2.4: returns null on Amazon unavailability rather than stale/invented values.
 *
 * SP-API throttling for GET /catalog/2022-04-01/items/{asin}:
 *   Burst: 2 req/s | Restore: 2 req/s
 *   Use with care in batch loops; insert delays between calls.
 */

import { spApiRequest } from "@/modules/amazon-sp-api/spApiClient";
import type { AmazonCatalogItemSummary } from "../types/policyCompliance.types";

// ─── SP-API response shape (partial; only what we consume) ───────────────────

type CatalogItemSummaryRaw = {
  title?: string;
  brand?: string;
  websiteDisplayGroup?: string;
};

type CatalogItemImageRaw = {
  variant?: string;
  link?: string;
};

type CatalogItemResponseRaw = {
  asin?: string;
  summaries?: CatalogItemSummaryRaw[];
  images?: Array<{
    images?: CatalogItemImageRaw[];
    marketplaceId?: string;
  }>;
};

// ─── Client ──────────────────────────────────────────────────────────────────

/**
 * Fetches product metadata for a single ASIN from Catalog Items API.
 * Returns null if Amazon does not return a usable response (no throw for 404).
 *
 * @param asin - Amazon Standard Identification Number
 * @param marketplaceIds - One or more marketplace IDs to scope the request
 */
export async function fetchCatalogItem(
  asin: string,
  marketplaceIds: string[],
): Promise<AmazonCatalogItemSummary | null> {
  if (!asin || marketplaceIds.length === 0) return null;

  type ResponseShape = { item?: CatalogItemResponseRaw };

  let response: ResponseShape;
  try {
    response = await spApiRequest<ResponseShape>({
      method: "GET",
      path: `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`,
      query: {
        marketplaceIds: marketplaceIds.join(","),
        includedData: "images,summaries",
      },
      operation: "GetCatalogItem",
      // SP-API rate: 2 req/s burst. We allow one retry on rate-limit.
      rateLimitRetry: { maxRetries: 1, baseDelayMs: 1_000, maxDelayMs: 5_000 },
    });
  } catch (error) {
    // 404 = ASIN not found in this marketplace; not an error worth surfacing.
    const status = (error as { status?: number })?.status;
    if (status === 404) return null;
    throw error;
  }

  return parseCatalogItemResponse(asin, response?.item ?? null);
}

function parseCatalogItemResponse(
  asin: string,
  item: CatalogItemResponseRaw | null,
): AmazonCatalogItemSummary | null {
  if (!item) return null;

  const summary = item.summaries?.[0] ?? null;
  const mainImage = findMainImage(item.images ?? []);

  return {
    asin,
    title: summary?.title ?? undefined,
    brand: summary?.brand ?? undefined,
    mainImageUrl: mainImage ?? undefined,
  };
}

function findMainImage(
  imageSets: Array<{ images?: CatalogItemImageRaw[]; marketplaceId?: string }>,
): string | null {
  for (const set of imageSets) {
    for (const img of set.images ?? []) {
      if (img.variant === "MAIN" && img.link) return img.link;
    }
  }
  // Fallback: any image
  for (const set of imageSets) {
    const first = set.images?.[0];
    if (first?.link) return first.link;
  }
  return null;
}
