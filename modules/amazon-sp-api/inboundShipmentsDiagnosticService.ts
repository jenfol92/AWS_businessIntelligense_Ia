import { extractTwinlySkuFromSellerSku } from "@/modules/imports/shared/twinlySku";
import { supabaseAdmin } from "@/server/supabase/adminClient";
import { mapGenericError } from "./errors";
import { spApiRequest } from "./spApiClient";

type RawRecord = Record<string, unknown>;

export type AmazonInboundShipmentItemDiagnostic = {
  seller_sku: string | null;
  sku_limpio: string | null;
  producto_id: string | null;
  expected_quantity: number;
  located_quantity: number;
  received_quantity: number;
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
  expected_units: number;
  located_units: number;
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

export type AmazonInboundShipmentsDiagnosticResult = {
  ok: true;
  source: "fulfillment-inbound-v2024-03-20" | "fulfillment-inbound-v0";
  api_attempts: AmazonInboundApiAttempt[];
  shipments: AmazonInboundShipmentDiagnostic[];
};

const DEFAULT_V0_STATUSES = [
  "WORKING",
  "READY_TO_SHIP",
  "SHIPPED",
  "IN_TRANSIT",
  "DELIVERED",
  "CHECKED_IN",
  "RECEIVING",
  "CLOSED",
  "CANCELLED",
  "DELETED",
  "ERROR",
];
const ACTIVE_V0_STATUSES = DEFAULT_V0_STATUSES.filter(
  (status) => !["CLOSED", "CANCELLED", "DELETED", "ERROR"].includes(status),
);

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
      expected: acc.expected + item.expected_quantity,
      located: acc.located + item.located_quantity,
      received: acc.received + item.received_quantity,
    }),
    { expected: 0, located: 0, received: 0 },
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
  const expected = num(
    pick(raw, [
      "quantity",
      "QuantityShipped",
      "quantityShipped",
      "expectedQuantity",
      "quantityExpected",
      "QuantityInCase",
    ]),
  );
  const received = num(
    pick(raw, ["QuantityReceived", "quantityReceived", "receivedQuantity"]),
  );
  const located = num(
    pick(raw, [
      "locatedQuantity",
      "quantityLocated",
      "QuantityLocated",
      "receivedQuantity",
      "QuantityReceived",
    ]),
  );

  return {
    seller_sku: sellerSku,
    sku_limpio: sellerSku ? extractTwinlySkuFromSellerSku(sellerSku) : null,
    producto_id: null,
    expected_quantity: expected,
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
    located_units: totals.located || totals.received,
    raw_date_keys: rawDateKeys(raw),
    raw_status: str(pick(raw, ["status", "shipmentStatus", "ShipmentStatus"])),
    raw_shipment_name: str(pick(raw, ["name", "shipmentName", "ShipmentName"])),
    items,
    raw,
  } satisfies AmazonInboundShipmentDiagnostic;
}

async function fetchV2024Shipments(limit: number) {
  const plansResponse = await spApiRequest<unknown>({
    method: "GET",
    path: "/inbound/fba/2024-03-20/inboundPlans",
    query: { pageSize: String(Math.min(limit, 50)) },
  });
  const plans = arrayFrom(plansResponse, ["inboundPlans", "plans"]);
  const shipments: AmazonInboundShipmentDiagnostic[] = [];

  for (const plan of plans.slice(0, limit)) {
    const planId = str(pick(plan, ["inboundPlanId", "id", "planId"]));
    if (!planId) continue;

    const [shipmentsResponse, itemsResponse] = await Promise.all([
      spApiRequest<unknown>({
        method: "GET",
        path: `/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(
          planId,
        )}/shipments`,
      }),
      spApiRequest<unknown>({
        method: "GET",
        path: `/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(
          planId,
        )}/items`,
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

  if (shipments.length === 0) {
    throw new Error("Fulfillment Inbound v2024-03-20 no devolvio shipments utilizables.");
  }

  return shipments;
}

async function fetchV0Shipments(params: {
  limit: number;
  lastUpdatedAfter?: string | null;
  includeClosed?: boolean;
}) {
  const response = await spApiRequest<unknown>({
    method: "GET",
    path: "/fba/inbound/v0/shipments",
    query: {
      ShipmentStatusList: (params.includeClosed ? DEFAULT_V0_STATUSES : ACTIVE_V0_STATUSES).join(","),
      LastUpdatedAfter: params.lastUpdatedAfter ?? undefined,
    },
  });

  const rawShipments = arrayFrom(response, ["ShipmentData", "shipments"]).slice(0, params.limit);
  const shipments: AmazonInboundShipmentDiagnostic[] = [];

  for (const rawShipment of rawShipments) {
    const shipmentId = str(pick(rawShipment, ["ShipmentId", "shipmentId"]));
    let items: AmazonInboundShipmentItemDiagnostic[] = [];

    if (shipmentId) {
      const itemsResponse = await spApiRequest<unknown>({
        method: "GET",
        path: `/fba/inbound/v0/shipments/${encodeURIComponent(shipmentId)}/items`,
      });
      items = arrayFrom(itemsResponse, ["ItemData", "items"]).map(mapItem);
    }

    shipments.push(mapShipment(rawShipment, items));
  }

  return shipments;
}

export async function buildAmazonInboundShipmentsDiagnostic(params: {
  limit?: number;
  lastUpdatedAfter?: string | null;
  includeClosed?: boolean;
} = {}): Promise<AmazonInboundShipmentsDiagnosticResult> {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const api_attempts: AmazonInboundApiAttempt[] = [];

  try {
    const shipments = await attachProductIds(await fetchV2024Shipments(limit));
    api_attempts.push({
      api: "fulfillment-inbound-v2024-03-20",
      ok: true,
      message: "Shipments leidos desde Fulfillment Inbound v2024-03-20.",
    });
    return {
      ok: true,
      source: "fulfillment-inbound-v2024-03-20",
      api_attempts,
      shipments,
    };
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    api_attempts.push({
      api: "fulfillment-inbound-v2024-03-20",
      ok: false,
      message: mapped.message,
      status: mapped.status,
    });
  }

  try {
    const shipments = await attachProductIds(
      await fetchV0Shipments({
        limit,
        lastUpdatedAfter: params.lastUpdatedAfter,
        includeClosed: params.includeClosed,
      }),
    );
    api_attempts.push({
      api: "fulfillment-inbound-v0",
      ok: true,
      message: "Shipments leidos desde Fulfillment Inbound v0.",
    });
    return {
      ok: true,
      source: "fulfillment-inbound-v0",
      api_attempts,
      shipments,
    };
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    api_attempts.push({
      api: "fulfillment-inbound-v0",
      ok: false,
      message: mapped.message,
      status: mapped.status,
    });
    throw error;
  }
}
