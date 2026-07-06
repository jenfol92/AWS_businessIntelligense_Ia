import { isAwsSigV4Configured, loadSpApiConfig } from "./config";
import { getLwaAccessToken } from "./lwaClient";
import { signSpApiRequest } from "./signing";

const ENDPOINT = "/vendor/shipping/v1/shipments";

type RawRecord = Record<string, unknown>;

export type VendorShipmentDetailsDiagnosticInput = {
  shipmentId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
};

type RawSpApiResponse = {
  status: number;
  requestId: string | null;
  body: unknown;
};

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeString(value: unknown): string {
  return String(value ?? "").trim();
}

function buildUrl(
  endpoint: string,
  path: string,
  query: Record<string, string | undefined>,
): string {
  const url = new URL(path, endpoint);
  for (const [key, value] of Object.entries(query)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

function collectShipments(body: unknown): RawRecord[] {
  if (!isRecord(body)) return [];

  const direct = body.shipments;
  if (Array.isArray(direct)) return direct.filter(isRecord);

  const payload = body.payload;
  if (isRecord(payload) && Array.isArray(payload.shipments)) {
    return payload.shipments.filter(isRecord);
  }

  if (Array.isArray(payload)) return payload.filter(isRecord);
  return [];
}

function deepStringIncludes(value: unknown, needle: string): boolean {
  if (!needle) return false;
  if (value == null) return false;
  if (typeof value === "string" || typeof value === "number") {
    return String(value).toLowerCase().includes(needle.toLowerCase());
  }
  if (Array.isArray(value)) {
    return value.some((item) => deepStringIncludes(item, needle));
  }
  if (isRecord(value)) {
    return Object.values(value).some((item) => deepStringIncludes(item, needle));
  }
  return false;
}

function getPath(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!isRecord(current)) return undefined;
    return current[segment];
  }, value);
}

function hasPath(value: unknown, path: string): boolean {
  const found = getPath(value, path);
  if (Array.isArray(found)) return found.length > 0;
  return found != null && found !== "";
}

function fieldValue(value: unknown, path: string): unknown {
  const found = getPath(value, path);
  if (found == null || found === "") return null;
  return found;
}

function detectFields(shipments: RawRecord[]) {
  const paths = [
    "transportationDetails.shippedDate",
    "transportationDetails.estimatedDeliveryDate",
    "transportationDetails.carrierDetails",
    "importDetails.importContainers",
    "importDetails.route.stops",
    "estimatedShipByDate",
    "trackingNumber",
    "carrierTrackingReference",
    "vendorShipmentIdentifier",
  ];

  return Object.fromEntries(
    paths.map((path) => [path, shipments.some((shipment) => hasPath(shipment, path))]),
  );
}

function summarizeShipment(shipment: RawRecord) {
  return {
    vendorShipmentIdentifier: fieldValue(shipment, "vendorShipmentIdentifier"),
    shipmentId: fieldValue(shipment, "shipmentId"),
    trackingNumber: fieldValue(shipment, "trackingNumber"),
    carrierTrackingReference: fieldValue(shipment, "carrierTrackingReference"),
    estimatedShipByDate: fieldValue(shipment, "estimatedShipByDate"),
    transportationDetails: fieldValue(shipment, "transportationDetails"),
    importDetails: fieldValue(shipment, "importDetails"),
    raw: shipment,
  };
}

function extractError(body: unknown, requestId: string | null) {
  if (isRecord(body) && Array.isArray(body.errors)) {
    const first = body.errors.find(isRecord) as RawRecord | undefined;
    return {
      code: safeString(first?.code),
      message: safeString(first?.message),
      details: first?.details ?? null,
      requestId,
      body,
    };
  }

  return {
    code: "",
    message: "",
    details: null,
    requestId,
    body,
  };
}

async function rawSpApiGet(
  path: string,
  query: Record<string, string | undefined>,
): Promise<RawSpApiResponse> {
  const config = loadSpApiConfig();
  const { accessToken } = await getLwaAccessToken(config);

  let url: string;
  let headers: Record<string, string>;

  if (isAwsSigV4Configured(config)) {
    const signed = await signSpApiRequest({
      config,
      method: "GET",
      path,
      query,
      accessToken,
    });
    const endpointUrl = new URL(config.endpoint);
    url = `${endpointUrl.origin}${signed.path}`;
    headers = Object.fromEntries(
      Object.entries(signed.headers ?? {}).map(([key, value]) => [
        key,
        String(value),
      ]),
    );
  } else {
    url = buildUrl(config.endpoint, path, query);
    headers = {
      "x-amz-access-token": accessToken,
      "user-agent": "ERP-BI-IA/1.0 (Language=TypeScript)",
    };
  }

  const res = await fetch(url, { method: "GET", headers });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    status: res.status,
    requestId:
      res.headers.get("x-amzn-requestid") ??
      res.headers.get("x-amz-request-id") ??
      null,
    body,
  };
}

export async function buildVendorShipmentDetailsDiagnostic(
  input: VendorShipmentDetailsDiagnosticInput,
) {
  const limit = Math.min(Math.max(Math.round(Number(input.limit ?? 25)), 1), 50);
  const params: Record<string, string | undefined> = {
    limit: String(limit),
    sortOrder: "DESC",
    shippedAfter: input.fromDate,
    shippedBefore: input.toDate,
  };

  const response = await rawSpApiGet(ENDPOINT, params);
  const shipments = collectShipments(response.body);
  const shipmentId = safeString(input.shipmentId);
  const matchedShipments = shipmentId
    ? shipments.filter((shipment) => deepStringIncludes(shipment, shipmentId))
    : shipments;

  const fieldsDetected = detectFields(matchedShipments.length > 0 ? matchedShipments : shipments);

  return {
    ok: true,
    status: response.status,
    requestId: response.requestId,
    endpoint: ENDPOINT,
    params,
    vendorApiAvailable: response.status >= 200 && response.status < 300,
    matchedShipments: matchedShipments.map(summarizeShipment),
    totalShipments: shipments.length,
    fieldsDetected,
    error:
      response.status >= 200 && response.status < 300
        ? null
        : extractError(response.body, response.requestId),
  };
}
