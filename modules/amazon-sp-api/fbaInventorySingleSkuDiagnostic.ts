import { newInventoryAttemptId, inventoryOperationalPool, sellerSkusSafeHash } from "./inventorySummaryTelemetryUtils.ts";
import type { InventorySummaryRequestTelemetry } from "./inventorySummaryRequestTelemetry";

type SpApiResponseMetadata = {
  operation: string;
  status: number;
  observedRateLimit: string | null;
  retryAfter: string | null;
  requestId: string | null;
  observedAt: string;
};

type DiagnosticRequestInput = {
  method: "GET";
  path: string;
  operation: string;
  query: Record<string, string | undefined>;
  rateLimitRetry: { maxRetries: number };
  retryExpiredAccessToken: boolean;
  onResponseMetadata: (metadata: SpApiResponseMetadata) => void;
};

export const ALAIA_DIAGNOSTIC_SKU = "8436616610104";
export const ALAIA_DIAGNOSTIC_ASIN = "B0DJBQGKBT";

export const INVENTORY_DIAGNOSTIC_MARKETPLACES = {
  ES: "A1RKKUPIHCS9HS",
  FR: "A13V1IB3VIYZZH",
  DE: "A1PA6795UKMFR9",
  IT: "APJ6JRA9NG5V4",
  GB: "A1F83G8C2ARO7P",
  PL: "A1C3SOZRARQ6R3",
  SE: "A2NODRKZP88ZB9",
} as const;

export type InventoryDiagnosticMarketplace = keyof typeof INVENTORY_DIAGNOSTIC_MARKETPLACES;

type Quantity = number | null;

export type InventoryMarketplaceSignature = {
  marketplace: InventoryDiagnosticMarketplace;
  marketplaceId: string;
  sellerSku: string | null;
  asin: string | null;
  fnSku: string | null;
  fulfillableQuantity: Quantity;
  reservedQuantity: {
    totalReservedQuantity: Quantity;
    pendingCustomerOrderQuantity: Quantity;
    pendingTransshipmentQuantity: Quantity;
    fcProcessingQuantity: Quantity;
  };
  inboundWorkingQuantity: Quantity;
  inboundShippedQuantity: Quantity;
  inboundReceivingQuantity: Quantity;
  unfulfillableQuantity: { totalUnfulfillableQuantity: Quantity };
  researchingQuantity: { totalResearchingQuantity: Quantity };
  totalQuantity: Quantity;
  lastUpdatedTime: string | null;
  nextTokenPresent: boolean;
};

export type SingleSkuInventoryDiagnosticResult = {
  status: "OK" | "UNEXPECTED_PAGINATION";
  marketplace: InventoryDiagnosticMarketplace;
  marketplaceId: string;
  requestedSellerSku: string;
  amazonHttpCalls: 1;
  responseMetadata: SpApiResponseMetadata | null;
  nextTokenPresent: boolean;
  signatures: InventoryMarketplaceSignature[];
  observedAt: string;
};

type InventorySummaryApiRow = {
  sellerSku?: unknown;
  asin?: unknown;
  fnSku?: unknown;
  lastUpdatedTime?: unknown;
  totalQuantity?: unknown;
  inventoryDetails?: {
    fulfillableQuantity?: unknown;
    reservedQuantity?: {
      totalReservedQuantity?: unknown;
      pendingCustomerOrderQuantity?: unknown;
      pendingTransshipmentQuantity?: unknown;
      fcProcessingQuantity?: unknown;
    };
    inboundWorkingQuantity?: unknown;
    inboundShippedQuantity?: unknown;
    inboundReceivingQuantity?: unknown;
    unfulfillableQuantity?: { totalUnfulfillableQuantity?: unknown };
    researchingQuantity?: { totalResearchingQuantity?: unknown };
  };
};

type InventorySummariesApiResponse = {
  payload?: { inventorySummaries?: InventorySummaryApiRow[] };
  pagination?: { nextToken?: string };
};

export type InventoryDiagnosticRequester = <T>(input: DiagnosticRequestInput) => Promise<T>;

function nullableString(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function nullableQuantity(value: unknown): Quantity {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSignature(params: {
  marketplace: InventoryDiagnosticMarketplace;
  marketplaceId: string;
  row: InventorySummaryApiRow;
  nextTokenPresent: boolean;
}): InventoryMarketplaceSignature {
  const details = params.row.inventoryDetails ?? {};
  const reserved = details.reservedQuantity ?? {};
  return {
    marketplace: params.marketplace,
    marketplaceId: params.marketplaceId,
    sellerSku: nullableString(params.row.sellerSku),
    asin: nullableString(params.row.asin),
    fnSku: nullableString(params.row.fnSku),
    fulfillableQuantity: nullableQuantity(details.fulfillableQuantity),
    reservedQuantity: {
      totalReservedQuantity: nullableQuantity(reserved.totalReservedQuantity),
      pendingCustomerOrderQuantity: nullableQuantity(reserved.pendingCustomerOrderQuantity),
      pendingTransshipmentQuantity: nullableQuantity(reserved.pendingTransshipmentQuantity),
      fcProcessingQuantity: nullableQuantity(reserved.fcProcessingQuantity),
    },
    inboundWorkingQuantity: nullableQuantity(details.inboundWorkingQuantity),
    inboundShippedQuantity: nullableQuantity(details.inboundShippedQuantity),
    inboundReceivingQuantity: nullableQuantity(details.inboundReceivingQuantity),
    unfulfillableQuantity: {
      totalUnfulfillableQuantity: nullableQuantity(
        details.unfulfillableQuantity?.totalUnfulfillableQuantity,
      ),
    },
    researchingQuantity: {
      totalResearchingQuantity: nullableQuantity(
        details.researchingQuantity?.totalResearchingQuantity,
      ),
    },
    totalQuantity: nullableQuantity(params.row.totalQuantity),
    lastUpdatedTime: nullableString(params.row.lastUpdatedTime),
    nextTokenPresent: params.nextTokenPresent,
  };
}

export function resolveInventoryDiagnosticMarketplace(value: string): {
  code: InventoryDiagnosticMarketplace;
  id: string;
} {
  const normalized = value.trim().toUpperCase();
  const byCode = INVENTORY_DIAGNOSTIC_MARKETPLACES[normalized as InventoryDiagnosticMarketplace];
  if (byCode) return { code: normalized as InventoryDiagnosticMarketplace, id: byCode };
  const found = Object.entries(INVENTORY_DIAGNOSTIC_MARKETPLACES).find(([, id]) => id === value.trim());
  if (!found) throw new Error("Marketplace no permitido para este diagnostico.");
  return { code: found[0] as InventoryDiagnosticMarketplace, id: found[1] };
}

export async function getSingleSkuInventoryMarketplaceSignature(params: {
  marketplace: string;
  sellerSku: string;
  request: InventoryDiagnosticRequester;
  persistTelemetry: (row: InventorySummaryRequestTelemetry) => Promise<void>;
}): Promise<SingleSkuInventoryDiagnosticResult> {
  const sellerSku = params.sellerSku.trim();
  if (!sellerSku) throw new Error("sellerSku es obligatorio.");
  const marketplace = resolveInventoryDiagnosticMarketplace(params.marketplace);
  const request = params.request;
  const attemptId = newInventoryAttemptId();
  const requestSequence = 1;
  const requestStartedAt = new Date().toISOString();
  const requestStartedMs = Date.now();
  const persistTelemetry = params.persistTelemetry;
  let calls = 0;
  let responseMetadata: SpApiResponseMetadata | null = null;

  const persist = async (outcome: InventorySummaryRequestTelemetry["outcome"], values: {
    nextTokenPresent: boolean | null;
    resultCount: number | null;
  }) => persistTelemetry({
    attemptId,
    requestSequence,
    startedAt: requestStartedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - requestStartedMs,
    marketplaceId: marketplace.id,
    operationalPool: inventoryOperationalPool(marketplace.id),
    batchNumber: 1,
    sellerSkuCount: 1,
    sellerSkusHash: sellerSkusSafeHash([sellerSku]),
    pageNumber: 1,
    httpStatus: responseMetadata?.status ?? null,
    amazonRequestId: responseMetadata?.requestId ?? null,
    observedRateLimit: responseMetadata?.observedRateLimit ?? null,
    retryAfter: responseMetadata?.retryAfter ?? null,
    nextTokenPresent: values.nextTokenPresent,
    resultCount: values.resultCount,
    outcome,
  });

  let response: InventorySummariesApiResponse;
  try {
    response = await request<InventorySummariesApiResponse>({
      method: "GET",
      path: "/fba/inventory/v1/summaries",
      operation: "getInventorySummaries.singleSkuDiagnostic",
      query: {
        sellerSkus: sellerSku,
        details: "true",
        granularityType: "Marketplace",
        granularityId: marketplace.id,
        marketplaceIds: marketplace.id,
      },
      rateLimitRetry: { maxRetries: 0 },
      retryExpiredAccessToken: false,
      onResponseMetadata(metadata) {
        calls += 1;
        responseMetadata = metadata;
      },
    });
  } catch (error) {
    const errorRecord = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
    const outcome = errorRecord.code === "rate_limited" || errorRecord.status === 429
      ? "RATE_LIMITED"
      : "FAILED";
    await persist(outcome, { nextTokenPresent: null, resultCount: null });
    throw error;
  }

  // A requester used in tests must preserve the same one-request invariant.
  if (calls === 0) calls = 1;
  if (calls !== 1) throw new Error(`DIAGNOSTIC_REQUEST_LIMIT_EXCEEDED:${calls}`);
  const nextTokenPresent = Boolean(response.pagination?.nextToken);
  const observedAt = new Date().toISOString();
  const signatures = (response.payload?.inventorySummaries ?? []).map((row) =>
    normalizeSignature({ marketplace: marketplace.code, marketplaceId: marketplace.id, row, nextTokenPresent }),
  );
  await persist(
    nextTokenPresent ? "UNEXPECTED_FILTERED_PAGINATION" : "SUCCESS",
    { nextTokenPresent, resultCount: signatures.length },
  );

  return {
    status: nextTokenPresent ? "UNEXPECTED_PAGINATION" : "OK",
    marketplace: marketplace.code,
    marketplaceId: marketplace.id,
    requestedSellerSku: sellerSku,
    amazonHttpCalls: 1,
    responseMetadata,
    nextTokenPresent,
    signatures,
    observedAt,
  };
}

const QUANTITY_PATHS = [
  "fulfillableQuantity",
  "reservedQuantity.totalReservedQuantity",
  "reservedQuantity.pendingCustomerOrderQuantity",
  "reservedQuantity.pendingTransshipmentQuantity",
  "reservedQuantity.fcProcessingQuantity",
  "inboundWorkingQuantity",
  "inboundShippedQuantity",
  "inboundReceivingQuantity",
  "unfulfillableQuantity.totalUnfulfillableQuantity",
  "researchingQuantity.totalResearchingQuantity",
  "totalQuantity",
] as const;

function valueAt(signature: InventoryMarketplaceSignature, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined,
  signature);
}

function identityKey(signature: InventoryMarketplaceSignature): string | null {
  return signature.asin && signature.sellerSku && signature.fnSku
    ? `${signature.asin}|${signature.sellerSku}|${signature.fnSku}`
    : null;
}

export type InventoryMarketplaceComparison = {
  result: "IDENTICAL" | "DIFFERENT" | "INCOMPLETE";
  comparedAt: string;
  marketplaceA: string;
  marketplaceB: string;
  exactIdentity: {
    onlyInA: string[];
    onlyInB: string[];
    differences: Array<{ identity: string; field: string; a: unknown; b: unknown }>;
  };
  asinIdentity: Array<{
    asin: string;
    identitiesA: string[];
    identitiesB: string[];
    aggregated: false;
  }>;
  note: "OPERATIONAL_EQUIVALENCE_ONLY_NO_PHYSICAL_LOCATION_INFERENCE";
};

export function compareInventoryMarketplaceSignatures(
  a: SingleSkuInventoryDiagnosticResult,
  b: SingleSkuInventoryDiagnosticResult,
): InventoryMarketplaceComparison {
  const comparedAt = new Date().toISOString();
  const base = {
    comparedAt,
    marketplaceA: a.marketplace,
    marketplaceB: b.marketplace,
    note: "OPERATIONAL_EQUIVALENCE_ONLY_NO_PHYSICAL_LOCATION_INFERENCE" as const,
  };
  const incomplete = a.status !== "OK" || b.status !== "OK" || a.signatures.length === 0 || b.signatures.length === 0;
  const keyedA = new Map(a.signatures.map((row) => [identityKey(row), row]));
  const keyedB = new Map(b.signatures.map((row) => [identityKey(row), row]));
  if (
    keyedA.has(null) ||
    keyedB.has(null) ||
    keyedA.size !== a.signatures.length ||
    keyedB.size !== b.signatures.length
  ) {
    return { ...base, result: "INCOMPLETE", exactIdentity: { onlyInA: [], onlyInB: [], differences: [] }, asinIdentity: [] };
  }
  const keysA = Array.from(keyedA.keys()) as string[];
  const keysB = Array.from(keyedB.keys()) as string[];
  const onlyInA = keysA.filter((key) => !keyedB.has(key));
  const onlyInB = keysB.filter((key) => !keyedA.has(key));
  const differences: InventoryMarketplaceComparison["exactIdentity"]["differences"] = [];
  for (const key of keysA.filter((item) => keyedB.has(item))) {
    const rowA = keyedA.get(key)!;
    const rowB = keyedB.get(key)!;
    for (const field of QUANTITY_PATHS) {
      const valueA = valueAt(rowA, field);
      const valueB = valueAt(rowB, field);
      if (valueA == null || valueB == null) {
        differences.push({ identity: key, field, a: valueA ?? null, b: valueB ?? null });
      } else if (valueA !== valueB) {
        differences.push({ identity: key, field, a: valueA, b: valueB });
      }
    }
  }
  const asins = Array.from(new Set(
    [...a.signatures, ...b.signatures].map((row) => row.asin).filter(Boolean),
  )) as string[];
  const asinIdentity = asins.map((asin) => ({
    asin,
    identitiesA: keysA.filter((key) => key.startsWith(`${asin}|`)).sort(),
    identitiesB: keysB.filter((key) => key.startsWith(`${asin}|`)).sort(),
    aggregated: false as const,
  }));
  const hasMissingQuantity = differences.some((item) => item.a == null || item.b == null);
  return {
    ...base,
    result: incomplete || hasMissingQuantity
      ? "INCOMPLETE"
      : onlyInA.length || onlyInB.length || differences.length
        ? "DIFFERENT"
        : "IDENTICAL",
    exactIdentity: { onlyInA, onlyInB, differences },
    asinIdentity,
  };
}

export function safeSingleSkuDiagnosticError(error: unknown) {
  const candidate = typeof error === "object" && error !== null
    ? error as Record<string, unknown>
    : {};
  const details = typeof candidate.details === "object" && candidate.details !== null
    ? candidate.details as Record<string, unknown>
    : {};
  const headers = typeof details.headers === "object" && details.headers !== null
    ? details.headers as Record<string, unknown>
    : {};
  const amazonErrors = Array.isArray(details.errors) ? details.errors : [];
  const first = typeof amazonErrors[0] === "object" && amazonErrors[0] !== null
    ? amazonErrors[0] as Record<string, unknown>
    : {};
  const upstream = typeof details.upstream === "object" && details.upstream !== null
    ? details.upstream as Record<string, unknown>
    : null;
  return {
    code: candidate.code == null ? "unknown" : String(candidate.code),
    httpStatus: typeof candidate.status === "number" ? candidate.status : null,
    amazonCode: first.code == null ? null : String(first.code),
    amazonMessage: first.message == null
      ? error instanceof Error ? error.message : "Error de diagnostico SP-API."
      : String(first.message),
    requestId: details.requestId == null ? null : String(details.requestId),
    retryAfter: headers["retry-after"] == null ? null : String(headers["retry-after"]),
    observedRateLimit: headers["x-amzn-ratelimit-limit"] == null
      ? null
      : String(headers["x-amzn-ratelimit-limit"]),
    failureLayer: upstream?.layer === "LWA" || upstream?.layer === "SP_API"
      ? upstream.layer
      : null,
    network: upstream,
  };
}
