import { extractTwinlySkuFromSellerSku } from "@/modules/imports/shared/twinlySku";
import { supabaseAdmin } from "@/server/supabase/adminClient";
import { parseOptionalQuantity } from "./inboundShipmentQuantitySemantics";
import { mapGenericError } from "./errors";
import { logInboundSpApiFailure } from "./inboundSyncErrorInstrumentation";
import { spApiRequest } from "./spApiClient";
import { paginateV2024InboundPlans } from "./v2024InboundPlansPagination";
import {
  createV0ShipmentItemsAcquisitionState,
  fetchV0ShipmentItemsSequential,
  mergeV0ShipmentItemsAcquisitionState,
  type V0ShipmentItemsAcquisitionState,
} from "./v0ShipmentItemsAcquisition";

type RawRecord = Record<string, unknown>;

export type AmazonInboundShipmentItemDiagnostic = {
  seller_sku: string | null;
  sku_limpio: string | null;
  producto_id: string | null;
  /** Planned/expected quantity from v2024. null = this source has no planned quantity. */
  expected_quantity: number | null;
  /** Actually shipped quantity from v0 QuantityShipped. null = field absent. */
  shipped_quantity: number | null;
  /** Located/scanned quantity at FC from v0. null = field absent. */
  located_quantity: number | null;
  /** Received quantity from v0 QuantityReceived. null = field absent. */
  received_quantity: number | null;
  raw?: unknown;
};

export type AmazonInboundShipmentDiagnostic = {
  amazon_shipment_id: string | null;
  amazon_inbound_plan_id: string | null;
  amazon_reference_id: string | null;
  shipment_name: string | null;
  status: string | null;
  destination_fc: string | null;
  created_at_amazon: string | null;
  updated_at_amazon: string | null;
  /** Total expected/planned units from v2024. */
  expected_units: number | null;
  /** Total shipped units from v0 QuantityShipped. */
  shipped_units: number | null;
  /** Total located/scanned units from v0. */
  located_units: number | null;
  raw_date_keys?: string[];
  raw_status?: string | null;
  raw_shipment_name?: string | null;
  items: AmazonInboundShipmentItemDiagnostic[];
  raw?: unknown;
};

export type AmazonInboundApiAttempt = {
  api: "fulfillment-inbound-v2024-03-20" | "fulfillment-inbound-v0";
  ok: boolean;
  message: string;
  status?: number;
};

/** Pagination result for a single v0 acquisition stream. */
type V0PaginationResult = {
  shipments: AmazonInboundShipmentDiagnostic[];
  pagesFetched: number;
  acquisitionComplete: boolean;
  nextTokenPending: boolean;
  cycleDetected: boolean;
  usedLastUpdatedAfter: boolean;
  shipmentItems: V0ShipmentItemsAcquisitionState;
};

/** Diagnostic metadata for v0 shipment discovery with full pagination info. */
export type V0DiscoveryDiagnostic = {
  activeShipmentsFetched: number;
  activePagesFetched: number;
  activeAcquisitionComplete: boolean;
  activeNextTokenPending: boolean;
  activeCycleDetected: boolean;
  /** MUST always be false — active discovery never uses date filter. */
  activeDiscoveryUsedLastUpdatedAfter: boolean;

  terminalShipmentsFetched: number;
  terminalPagesFetched: number;
  terminalAcquisitionComplete: boolean;
  terminalNextTokenPending: boolean;
  terminalCycleDetected: boolean;
  terminalDiscoveryUsedLastUpdatedAfter: boolean;

  shipmentsAfterDedup: number;

  /** v0 getShipmentItemsByShipmentId throttled acquisition. */
  shipmentItemsFetched: number;
  shipmentItemsSkippedAfterRateLimit: number;
  shipmentItemsRateLimited: boolean;
  shipmentItemsAcquisitionComplete: boolean;
  shipmentItemsRetryAfter: string | null;
};

/** Full discovery diagnostic including v2024 + v0 combined. */
export type FullDiscoveryDiagnostic = {
  shipmentsFetchedV2024: number;
  v2024AcquisitionComplete: boolean;
  v0Discovery: V0DiscoveryDiagnostic;
  shipmentsAfterDedup: number;
  /** true only when ALL discovery sources completed without pending tokens or cycles. */
  discoveryComplete: boolean;
};

export type AmazonInboundShipmentsDiagnosticResult = {
  ok: true;
  source: "combined" | "fulfillment-inbound-v2024-03-20" | "fulfillment-inbound-v0";
  api_attempts: AmazonInboundApiAttempt[];
  shipments: AmazonInboundShipmentDiagnostic[];
  discovery: FullDiscoveryDiagnostic;
};

/** Non-terminal statuses — shipments still operationally active. */
export const ACTIVE_V0_STATUSES = [
  "WORKING",
  "READY_TO_SHIP",
  "SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
  "CHECKED_IN",
  "RECEIVING",
] as const;

/** Terminal statuses — shipments that will not return to active. */
export const TERMINAL_V0_STATUSES = [
  "CLOSED",
  "CANCELLED",
  "CANCELED",
  "DELETED",
  "ABANDONED",
  "ERROR",
] as const;

const DEFAULT_V0_STATUSES = [...ACTIVE_V0_STATUSES, "CLOSED", "CANCELLED", "DELETED", "ERROR"];

function asRecord(value: unknown): RawRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : {};
}

function pick(value: unknown, keys: string[]): unknown {
  const record = asRecord(value);
  for (const key of keys) {
    if (record[key] != null) return record[key];
  }
  return null;
}

function str(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function rawDateKeys(raw: unknown): string[] {
  return Object.keys(asRecord(raw)).filter((key) => {
    const lower = key.toLowerCase();
    return lower.includes("date") || lower.includes("time") || lower.includes("updated") || lower.includes("created");
  });
}

function arrayFrom(value: unknown, keys: string[]): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of keys) {
    const child = record[key];
    if (Array.isArray(child)) return child;
  }
  const payload = asRecord(record.payload);
  for (const key of keys) {
    const child = payload[key];
    if (Array.isArray(child)) return child;
  }
  return [];
}

function addItemTotals(items: AmazonInboundShipmentItemDiagnostic[]) {
  return items.reduce(
    (acc, item) => ({
      expected: acc.expected + (item.expected_quantity ?? 0),
      shipped: acc.shipped + (item.shipped_quantity ?? 0),
      located: acc.located + (item.located_quantity ?? 0),
      received: acc.received + (item.received_quantity ?? 0),
    }),
    { expected: 0, shipped: 0, located: 0, received: 0 },
  );
}

async function attachProductIds(
  shipments: AmazonInboundShipmentDiagnostic[],
): Promise<AmazonInboundShipmentDiagnostic[]> {
  const cleanSkus = Array.from(
    new Set(
      shipments
        .flatMap((shipment) => shipment.items.map((item) => item.sku_limpio))
        .filter((sku): sku is string => Boolean(sku)),
    ),
  );

  if (cleanSkus.length === 0) return shipments;

  const { data, error } = await supabaseAdmin
    .from("productos")
    .select("id, sku")
    .in("sku", cleanSkus);

  if (error) throw new Error(error.message);

  const productBySku = new Map(
    (data ?? []).map((row) => [
      String((row as { sku?: unknown }).sku ?? "").trim(),
      String((row as { id?: unknown }).id ?? "").trim(),
    ]),
  );

  return shipments.map((shipment) => ({
    ...shipment,
    items: shipment.items.map((item) => ({
      ...item,
      producto_id: item.sku_limpio
        ? productBySku.get(item.sku_limpio) ?? null
        : null,
    })),
  }));
}

function mapItem(raw: unknown): AmazonInboundShipmentItemDiagnostic {
  const sellerSku = str(
    pick(raw, ["sellerSku", "sellerSKU", "SellerSKU", "msku", "sku", "SKU"]),
  );

  // Expected quantity: v2024 planned data (NOT QuantityShipped, NOT QuantityInCase)
  // QuantityInCase is "units per case" for case-packed shipments, NOT total expected.
  // Missing keys stay null — never coerce unknown to 0.
  const expected = parseOptionalQuantity(
    pick(raw, [
      "quantity",
      "expectedQuantity",
      "quantityExpected",
    ]),
  );

  const shipped = parseOptionalQuantity(
    pick(raw, [
      "QuantityShipped",
      "quantityShipped",
    ]),
  );

  const received = parseOptionalQuantity(
    pick(raw, ["QuantityReceived", "quantityReceived", "receivedQuantity"]),
  );

  const located = parseOptionalQuantity(
    pick(raw, [
      "locatedQuantity",
      "quantityLocated",
      "QuantityLocated",
    ]),
  );

  return {
    seller_sku: sellerSku,
    sku_limpio: sellerSku ? extractTwinlySkuFromSellerSku(sellerSku) : null,
    producto_id: null,
    expected_quantity: expected,
    shipped_quantity: shipped,
    located_quantity: located,
    received_quantity: received,
    raw,
  };
}

function mapShipment(raw: unknown, items: AmazonInboundShipmentItemDiagnostic[]) {
  const totals = addItemTotals(items);
  return {
    amazon_shipment_id: str(
      pick(raw, ["shipmentId", "shipmentID", "ShipmentId", "amazonShipmentId"]),
    ),
    amazon_inbound_plan_id: str(
      pick(raw, ["inboundPlanId", "InboundPlanId", "inboundPlanID"]),
    ),
    amazon_reference_id: str(
      pick(raw, ["referenceId", "referenceID", "ReferenceId", "shipmentConfirmationId"]),
    ),
    shipment_name: str(pick(raw, ["name", "shipmentName", "ShipmentName"])),
    status: str(pick(raw, ["status", "shipmentStatus", "ShipmentStatus"])),
    destination_fc: str(
      pick(raw, [
        "destinationFulfillmentCenterId",
        "destinationFc",
        "destinationFC",
        "DestinationFulfillmentCenterId",
      ]),
    ),
    created_at_amazon: str(
      pick(raw, [
        "createdAt",
        "createdDate",
        "CreatedDate",
        "creationDate",
        "ShipmentCreatedDate",
        "shipmentCreatedDate",
      ]),
    ),
    updated_at_amazon: str(
      pick(raw, [
        "updatedAt",
        "lastUpdatedAt",
        "lastUpdatedDate",
        "LastUpdatedDate",
        "updatedDate",
      ]),
    ),
    expected_units: totals.expected,
    shipped_units: totals.shipped,
    located_units: totals.located || totals.received,
    raw_date_keys: rawDateKeys(raw),
    raw_status: str(pick(raw, ["status", "shipmentStatus", "ShipmentStatus"])),
    raw_shipment_name: str(pick(raw, ["name", "shipmentName", "ShipmentName"])),
    items,
    raw,
  } satisfies AmazonInboundShipmentDiagnostic;
}

/** V2024 pagination constants */
const V2024_ABSOLUTE_MAX_PAGES = 20;

/** Result of v2024 shipments fetch with pagination status. */
type V2024FetchResult = {
  shipments: AmazonInboundShipmentDiagnostic[];
  pagesFetched: number;
  acquisitionComplete: boolean;
  isEmpty: boolean;
};

/**
 * Fetch v2024 shipments with full pagination.
 * An empty result is NOT an error — it means this is a legacy-only account.
 */
async function fetchV2024Shipments(): Promise<V2024FetchResult> {
  const pagination = await paginateV2024InboundPlans({
    request: spApiRequest,
    maxPages: V2024_ABSOLUTE_MAX_PAGES,
  });
  const allPlans = pagination.plans;
  const pagesFetched = pagination.pagesFetched;

  // If no plans, this is a legacy-only account — NOT an error
  if (allPlans.length === 0) {
    return {
      shipments: [],
      pagesFetched,
      acquisitionComplete: pagination.acquisitionComplete,
      isEmpty: true,
    };
  }

  // Fetch shipments and items for each plan
  const shipments: AmazonInboundShipmentDiagnostic[] = [];

  for (const plan of allPlans) {
    const planId = str(pick(plan, ["inboundPlanId", "id", "planId"]));
    if (!planId) continue;

    const [shipmentsResponse, itemsResponse] = await Promise.all([
      spApiRequest<unknown>({
        method: "GET",
        path: `/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(planId)}/shipments`,
      }),
      spApiRequest<unknown>({
        method: "GET",
        path: `/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(planId)}/items`,
      }),
    ]);

    const planItems = arrayFrom(itemsResponse, ["items"]).map(mapItem);
    const rawShipments = arrayFrom(shipmentsResponse, ["shipments"]);
    for (const rawShipment of rawShipments) {
      shipments.push(
        mapShipment(
          {
            ...asRecord(rawShipment),
            inboundPlanId: planId,
          },
          planItems,
        ),
      );
    }
  }

  return {
    shipments,
    pagesFetched,
    acquisitionComplete: pagination.acquisitionComplete,
    isEmpty: shipments.length === 0,
  };
}

/** Absolute max pages to prevent infinite loops. */
const V0_ABSOLUTE_MAX_PAGES = 50;

/**
 * Fetch items for a single shipment.
 */
async function fetchShipmentItems(
  shipmentId: string,
): Promise<AmazonInboundShipmentItemDiagnostic[]> {
  const itemsResponse = await spApiRequest<unknown>({
    method: "GET",
    path: `/fba/inbound/v0/shipments/${encodeURIComponent(shipmentId)}/items`,
    operation: `GET /fba/inbound/v0/shipments/${shipmentId}/items`,
  });
  return arrayFrom(itemsResponse, ["ItemData", "items"]).map(mapItem);
}

/**
 * Parse raw shipments into diagnostic format with throttled sequential item fetch.
 */
async function parseRawShipments(
  rawShipments: unknown[],
  itemsState: V0ShipmentItemsAcquisitionState,
): Promise<AmazonInboundShipmentDiagnostic[]> {
  const shipmentIds = rawShipments
    .map((rawShipment) => str(pick(rawShipment, ["ShipmentId", "shipmentId"])))
    .filter((id): id is string => Boolean(id));

  const itemsById = await fetchV0ShipmentItemsSequential({
    shipmentIds,
    state: itemsState,
    fetchItems: fetchShipmentItems,
  });

  const shipments: AmazonInboundShipmentDiagnostic[] = [];
  for (const rawShipment of rawShipments) {
    const shipmentId = str(pick(rawShipment, ["ShipmentId", "shipmentId"]));
    const items = shipmentId ? itemsById.get(shipmentId) ?? [] : [];
    shipments.push(mapShipment(rawShipment, items));
  }
  return shipments;
}

/**
 * Paginated v0 shipment fetch with correct Amazon QueryType handling.
 *
 * Amazon v0 API requires:
 * - Page 1: QueryType=SHIPMENT + ShipmentStatusList (+ optional LastUpdatedAfter)
 * - Page 2+: QueryType=NEXT_TOKEN + NextToken ONLY (no other params)
 *
 * @see https://developer-docs.amazon.com/sp-api/docs/fulfillment-inbound-api-v0-reference#getshipments
 */
async function fetchV0ShipmentsPaginated(params: {
  statusList: string;
  lastUpdatedAfter?: string | null;
  maxPages?: number;
}): Promise<V0PaginationResult> {
  const maxPages = params.maxPages ?? V0_ABSOLUTE_MAX_PAGES;
  const seenTokens = new Set<string>();
  const allShipments: AmazonInboundShipmentDiagnostic[] = [];
  const byId = new Map<string, AmazonInboundShipmentDiagnostic>();
  const shipmentItems = createV0ShipmentItemsAcquisitionState();
  let nextToken: string | null = null;
  let pagesFetched = 0;
  let cycleDetected = false;
  const usedLastUpdatedAfter = Boolean(params.lastUpdatedAfter);

  const finalizeAcquisitionComplete = (paginationComplete: boolean) =>
    paginationComplete && shipmentItems.acquisitionComplete;

  while (pagesFetched < maxPages) {
    // Amazon v0 API QueryType rules:
    // - First page: QueryType=SHIPMENT, with ShipmentStatusList and optional LastUpdatedAfter
    // - Next pages: QueryType=NEXT_TOKEN, with NextToken ONLY (no other params)
    const isFirstPage = nextToken === null;

    const query: Record<string, string | undefined> = isFirstPage
      ? {
          QueryType: "SHIPMENT",
          ShipmentStatusList: params.statusList,
          ...(params.lastUpdatedAfter ? { LastUpdatedAfter: params.lastUpdatedAfter } : {}),
        }
      : {
          QueryType: "NEXT_TOKEN",
          NextToken: nextToken,
          // NO ShipmentStatusList, NO LastUpdatedAfter on subsequent pages
        };

    const response = await spApiRequest<unknown>({
      method: "GET",
      path: "/fba/inbound/v0/shipments",
      query,
    });

    pagesFetched += 1;
    const rawShipments = arrayFrom(response, ["ShipmentData", "shipments"]);
    const pageShipments = await parseRawShipments(rawShipments, shipmentItems);

    // Deduplicate by ShipmentId
    for (const s of pageShipments) {
      const id = s.amazon_shipment_id;
      if (id && !byId.has(id)) {
        byId.set(id, s);
        allShipments.push(s);
      }
    }

    const responseRecord = asRecord(response);
    const newToken = str(responseRecord.NextToken ?? pick(response, ["nextToken", "next_token"]));

    if (shipmentItems.rateLimited) {
      return {
        shipments: allShipments,
        pagesFetched,
        acquisitionComplete: false,
        nextTokenPending: Boolean(newToken),
        cycleDetected,
        usedLastUpdatedAfter,
        shipmentItems,
      };
    }

    if (!newToken) {
      // No more pages — complete acquisition
      return {
        shipments: allShipments,
        pagesFetched,
        acquisitionComplete: finalizeAcquisitionComplete(true),
        nextTokenPending: false,
        cycleDetected: false,
        usedLastUpdatedAfter,
        shipmentItems,
      };
    }

    // Cycle detection
    if (seenTokens.has(newToken)) {
      cycleDetected = true;
      return {
        shipments: allShipments,
        pagesFetched,
        acquisitionComplete: false,
        nextTokenPending: false,
        cycleDetected: true,
        usedLastUpdatedAfter,
        shipmentItems,
      };
    }

    seenTokens.add(newToken);
    nextToken = newToken;
  }

  // Hit max pages limit
  return {
    shipments: allShipments,
    pagesFetched,
    acquisitionComplete: false,
    nextTokenPending: Boolean(nextToken),
    cycleDetected,
    usedLastUpdatedAfter,
    shipmentItems,
  };
}

/**
 * Fetch ACTIVE (non-terminal) shipments from Amazon v0 API with full pagination.
 * NEVER applies LastUpdatedAfter — we need ALL active shipments regardless of age.
 */
async function fetchV0ActiveShipmentsPaginated(): Promise<V0PaginationResult> {
  return fetchV0ShipmentsPaginated({
    statusList: ACTIVE_V0_STATUSES.join(","),
    lastUpdatedAfter: null, // NEVER use date filter for active
    maxPages: V0_ABSOLUTE_MAX_PAGES,
  });
}

/**
 * Fetch TERMINAL shipments from Amazon v0 API with full pagination.
 * Applies LastUpdatedAfter to limit historical data volume.
 */
async function fetchV0TerminalShipmentsPaginated(
  lastUpdatedAfter?: string | null,
): Promise<V0PaginationResult> {
  return fetchV0ShipmentsPaginated({
    statusList: "CLOSED,CANCELLED,DELETED,ERROR",
    lastUpdatedAfter,
    maxPages: V0_ABSOLUTE_MAX_PAGES,
  });
}

/**
 * Merge items from v2024 and v0 by SKU.
 * - expected_quantity: from v2024 (planned)
 * - shipped_quantity, received_quantity, located_quantity: from v0 (actual)
 */
function mergeItemsBySku(
  v2024Items: AmazonInboundShipmentItemDiagnostic[],
  v0Items: AmazonInboundShipmentItemDiagnostic[],
): AmazonInboundShipmentItemDiagnostic[] {
  const v2024BySku = new Map<string, AmazonInboundShipmentItemDiagnostic>();
  for (const item of v2024Items) {
    const sku = item.seller_sku ?? item.sku_limpio;
    if (sku) v2024BySku.set(sku, item);
  }

  const result: AmazonInboundShipmentItemDiagnostic[] = [];
  const seenSkus = new Set<string>();

  // Process v0 items first (authoritative for shipped/received/located)
  for (const v0Item of v0Items) {
    const sku = v0Item.seller_sku ?? v0Item.sku_limpio;
    if (sku && seenSkus.has(sku)) continue;
    if (sku) seenSkus.add(sku);

    const v2024Item = sku ? v2024BySku.get(sku) : null;
    if (v2024Item) {
      // SEMANTIC MERGE by SKU:
      // - v2024: expected_quantity (planned)
      // - v0: shipped, received, located (actual operational)
      result.push({
        seller_sku: v0Item.seller_sku,
        sku_limpio: v0Item.sku_limpio ?? v2024Item.sku_limpio,
        producto_id: v0Item.producto_id ?? v2024Item.producto_id,
        expected_quantity: v2024Item.expected_quantity, // v2024 planned
        shipped_quantity: v0Item.shipped_quantity,      // v0 actual shipped
        located_quantity: v0Item.located_quantity,      // v0 actual located
        received_quantity: v0Item.received_quantity,    // v0 actual received
        raw: v0Item.raw,
      });
    } else {
      // v0 only — no v2024 planned quantity. expected stays unknown (null), never QuantityShipped.
      result.push(v0Item);
    }
  }

  // Add v2024-only items (not in v0)
  for (const v2024Item of v2024Items) {
    const sku = v2024Item.seller_sku ?? v2024Item.sku_limpio;
    if (sku && !seenSkus.has(sku)) {
      seenSkus.add(sku);
      result.push(v2024Item);
    }
  }

  return result;
}

/**
 * Semantic merge of v2024 and v0 shipments.
 *
 * For duplicate ShipmentIds:
 * - STATUS: from v0 (authoritative for operational state)
 * - ITEMS: merged by SKU with v2024 expected + v0 shipped/received/located
 * - ENRICHMENT: inboundPlanId, referenceId from v2024
 *
 * v0 data is more reliable for operational state because it reflects the actual
 * fulfillment center receiving status.
 */
function mergeV2024AndV0Shipments(
  v2024Shipments: AmazonInboundShipmentDiagnostic[],
  v0Shipments: AmazonInboundShipmentDiagnostic[],
): AmazonInboundShipmentDiagnostic[] {
  const v2024ById = new Map<string, AmazonInboundShipmentDiagnostic>();
  for (const s of v2024Shipments) {
    const id = s.amazon_shipment_id;
    if (id) v2024ById.set(id, s);
  }

  const result: AmazonInboundShipmentDiagnostic[] = [];
  const seen = new Set<string>();

  // Process v0 shipments first (authoritative for operational data)
  for (const v0Ship of v0Shipments) {
    const id = v0Ship.amazon_shipment_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const v2024Ship = v2024ById.get(id);
    if (v2024Ship) {
      // SEMANTIC MERGE: merge items by SKU, then recalculate totals
      const mergedItems = mergeItemsBySku(v2024Ship.items, v0Ship.items);
      const totals = addItemTotals(mergedItems);

      result.push({
        // v0 operational data (authoritative)
        amazon_shipment_id: v0Ship.amazon_shipment_id,
        shipment_name: v0Ship.shipment_name,
        status: v0Ship.status, // v0 status is authoritative
        destination_fc: v0Ship.destination_fc,
        created_at_amazon: v0Ship.created_at_amazon ?? v2024Ship.created_at_amazon,
        updated_at_amazon: v0Ship.updated_at_amazon ?? v2024Ship.updated_at_amazon,
        expected_units: totals.expected,   // from merged items (v2024 planned)
        shipped_units: totals.shipped,     // from merged items (v0 actual)
        located_units: totals.located || totals.received,
        items: mergedItems,
        raw_date_keys: v0Ship.raw_date_keys,
        raw_status: v0Ship.raw_status,
        raw_shipment_name: v0Ship.raw_shipment_name,
        raw: v0Ship.raw,

        // v2024 enrichment (metadata only)
        amazon_inbound_plan_id: v2024Ship.amazon_inbound_plan_id ?? v0Ship.amazon_inbound_plan_id,
        amazon_reference_id: v2024Ship.amazon_reference_id ?? v0Ship.amazon_reference_id,
      });
    } else {
      // v0 only — no v2024 match
      result.push(v0Ship);
    }
  }

  // Add v2024-only shipments (not in v0)
  for (const v2024Ship of v2024Shipments) {
    const id = v2024Ship.amazon_shipment_id;
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(v2024Ship);
    }
  }

  return result;
}

/**
 * Simple deduplication for same-source shipments (e.g., active + terminal v0).
 * First occurrence wins.
 */
function deduplicateShipments(
  ...sources: AmazonInboundShipmentDiagnostic[][]
): AmazonInboundShipmentDiagnostic[] {
  const byId = new Map<string, AmazonInboundShipmentDiagnostic>();
  for (const source of sources) {
    for (const s of source) {
      const id = s.amazon_shipment_id;
      if (id && !byId.has(id)) byId.set(id, s);
    }
  }
  return Array.from(byId.values());
}

/**
 * Combined v0 shipment discovery with separate active/terminal acquisition
 * and full pagination support.
 */
async function fetchV0ShipmentsSeparated(params: {
  lastUpdatedAfter?: string | null;
  includeClosed?: boolean;
}): Promise<{
  shipments: AmazonInboundShipmentDiagnostic[];
  diagnostic: V0DiscoveryDiagnostic;
}> {
  // Always fetch ALL active shipments WITHOUT LastUpdatedAfter
  const activeResult = await fetchV0ActiveShipmentsPaginated();

  let terminalResult: V0PaginationResult = {
    shipments: [],
    pagesFetched: 0,
    acquisitionComplete: true,
    nextTokenPending: false,
    cycleDetected: false,
    usedLastUpdatedAfter: false,
    shipmentItems: createV0ShipmentItemsAcquisitionState(),
  };

  if (params.includeClosed) {
    terminalResult = await fetchV0TerminalShipmentsPaginated(params.lastUpdatedAfter);
  }

  const mergedItemsState = mergeV0ShipmentItemsAcquisitionState(
    activeResult.shipmentItems,
    terminalResult.shipmentItems,
  );

  const merged = deduplicateShipments(activeResult.shipments, terminalResult.shipments);

  return {
    shipments: merged,
    diagnostic: {
      activeShipmentsFetched: activeResult.shipments.length,
      activePagesFetched: activeResult.pagesFetched,
      activeAcquisitionComplete: activeResult.acquisitionComplete,
      activeNextTokenPending: activeResult.nextTokenPending,
      activeCycleDetected: activeResult.cycleDetected,
      activeDiscoveryUsedLastUpdatedAfter: false, // ALWAYS false by design

      terminalShipmentsFetched: terminalResult.shipments.length,
      terminalPagesFetched: terminalResult.pagesFetched,
      terminalAcquisitionComplete: terminalResult.acquisitionComplete,
      terminalNextTokenPending: terminalResult.nextTokenPending,
      terminalCycleDetected: terminalResult.cycleDetected,
      terminalDiscoveryUsedLastUpdatedAfter: terminalResult.usedLastUpdatedAfter,

      shipmentsAfterDedup: merged.length,

      shipmentItemsFetched: mergedItemsState.itemsFetched,
      shipmentItemsSkippedAfterRateLimit: mergedItemsState.itemsSkippedAfterRateLimit,
      shipmentItemsRateLimited: mergedItemsState.rateLimited,
      shipmentItemsAcquisitionComplete: mergedItemsState.acquisitionComplete,
      shipmentItemsRetryAfter: mergedItemsState.retryAfter,
    },
  };
}

/**
 * Combined discovery: v2024 + v0 with semantic merge.
 *
 * DESIGN: Both APIs are queried and results are merged.
 * - v2024 may contain NEW shipments created via Fulfillment Inbound 2024 workflow.
 * - v0 contains ALL legacy shipments + may still show new shipments.
 * - A mixed account can have both types simultaneously.
 *
 * We use v2024 AND v0, then SEMANTIC MERGE:
 * - v0 is authoritative for operational data (status, quantities)
 * - v2024 provides enrichment (inboundPlanId, etc.)
 *
 * An empty v2024 result is NOT a failure — it indicates a legacy-only account.
 */
export async function buildAmazonInboundShipmentsDiagnostic(params: {
  lastUpdatedAfter?: string | null;
  includeClosed?: boolean;
} = {}): Promise<AmazonInboundShipmentsDiagnosticResult> {
  const api_attempts: AmazonInboundApiAttempt[] = [];

  // Try v2024 first
  let v2024Shipments: AmazonInboundShipmentDiagnostic[] = [];
  let v2024AcquisitionComplete = false;
  let v2024IsEmpty = false;
  let v2024PagesFetched = 0;
  let v2024Error = false;

  try {
    const v2024Result = await fetchV2024Shipments();
    v2024Shipments = await attachProductIds(v2024Result.shipments);
    v2024AcquisitionComplete = v2024Result.acquisitionComplete;
    v2024IsEmpty = v2024Result.isEmpty;
    v2024PagesFetched = v2024Result.pagesFetched;
    api_attempts.push({
      api: "fulfillment-inbound-v2024-03-20",
      ok: true,
      message: v2024IsEmpty
        ? `v2024: empty (legacy-only account, ${v2024PagesFetched} pages scanned).`
        : `v2024: ${v2024Shipments.length} shipments (${v2024PagesFetched} pages).`,
    });
  } catch (error: unknown) {
    v2024Error = true;
    logInboundSpApiFailure(error, { api: "fulfillment-inbound-v2024-03-20" });
    const mapped = mapGenericError(error);
    api_attempts.push({
      api: "fulfillment-inbound-v2024-03-20",
      ok: false,
      message: mapped.message,
      status: mapped.status,
    });
    // v2024 failure is not fatal — v0 may still provide all data
  }

  // ALWAYS try v0 — it contains legacy shipments that v2024 won't return
  let v0Shipments: AmazonInboundShipmentDiagnostic[] = [];
  let v0Discovery: V0DiscoveryDiagnostic = {
    activeShipmentsFetched: 0,
    activePagesFetched: 0,
    activeAcquisitionComplete: false,
    activeNextTokenPending: false,
    activeCycleDetected: false,
    activeDiscoveryUsedLastUpdatedAfter: false,
    terminalShipmentsFetched: 0,
    terminalPagesFetched: 0,
    terminalAcquisitionComplete: true,
    terminalNextTokenPending: false,
    terminalCycleDetected: false,
    terminalDiscoveryUsedLastUpdatedAfter: false,
    shipmentsAfterDedup: 0,
    shipmentItemsFetched: 0,
    shipmentItemsSkippedAfterRateLimit: 0,
    shipmentItemsRateLimited: false,
    shipmentItemsAcquisitionComplete: true,
    shipmentItemsRetryAfter: null,
  };

  try {
    const v0Result = await fetchV0ShipmentsSeparated({
      lastUpdatedAfter: params.lastUpdatedAfter,
      includeClosed: params.includeClosed,
    });
    v0Shipments = await attachProductIds(v0Result.shipments);
    v0Discovery = v0Result.diagnostic;
    api_attempts.push({
      api: "fulfillment-inbound-v0",
      ok: true,
      message: `v0: Active=${v0Discovery.activeShipmentsFetched} (pages=${v0Discovery.activePagesFetched}), Terminal=${v0Discovery.terminalShipmentsFetched} (pages=${v0Discovery.terminalPagesFetched}).`,
    });
  } catch (error: unknown) {
    logInboundSpApiFailure(error, { api: "fulfillment-inbound-v0" });
    const mapped = mapGenericError(error);
    api_attempts.push({
      api: "fulfillment-inbound-v0",
      ok: false,
      message: mapped.message,
      status: mapped.status,
    });

    // If both failed, rethrow
    if (v2024Shipments.length === 0) {
      throw error;
    }
  }

  // SEMANTIC MERGE: v0 operational data + v2024 enrichment
  const combinedShipments = mergeV2024AndV0Shipments(v2024Shipments, v0Shipments);

  // Determine source label
  const hasV2024 = v2024Shipments.length > 0;
  const hasV0 = v0Shipments.length > 0;
  const source: AmazonInboundShipmentsDiagnosticResult["source"] =
    hasV2024 && hasV0 ? "combined" :
    hasV2024 ? "fulfillment-inbound-v2024-03-20" :
    "fulfillment-inbound-v0";

  // Discovery is complete when:
  // - v0 active acquisition is complete (mandatory)
  // - v0 terminal acquisition is complete (if includeClosed)
  // - v2024 is OK (see below)
  //
  // v2024 status rules:
  // - Empty with complete acquisition → OK (legacy-only account)
  // - Error → NOT OK (we cannot guarantee no v2024-only shipments exist)
  // - Cycle/token pending/max pages → NOT OK
  // - Acquisition complete with data → OK
  const v0Complete =
    v0Discovery.activeAcquisitionComplete &&
    v0Discovery.terminalAcquisitionComplete &&
    !v0Discovery.activeCycleDetected &&
    !v0Discovery.terminalCycleDetected &&
    v0Discovery.shipmentItemsAcquisitionComplete;

  // v2024 is OK only when:
  // - Empty AND acquisition completed (legacy account, no v2024 shipments exist)
  // - Not empty AND acquisition completed
  // v2024 is NOT OK when:
  // - Error occurred (we don't know if v2024-only shipments exist)
  // - Acquisition incomplete (cycle, token pending, max pages)
  const v2024Ok = v2024Error
    ? false  // Error means we can't guarantee completeness
    : v2024IsEmpty
      ? v2024AcquisitionComplete  // Empty only OK if acquisition was complete
      : v2024AcquisitionComplete; // Has data, must be complete

  // Discovery is complete if BOTH v0 and v2024 are OK
  const discoveryComplete = v0Complete && v2024Ok;

  return {
    ok: true,
    source,
    api_attempts,
    shipments: combinedShipments,
    discovery: {
      shipmentsFetchedV2024: v2024Shipments.length,
      v2024AcquisitionComplete: v2024AcquisitionComplete || v2024IsEmpty,
      v0Discovery,
      shipmentsAfterDedup: combinedShipments.length,
      discoveryComplete,
    },
  };
}
