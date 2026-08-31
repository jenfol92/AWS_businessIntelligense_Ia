/**
 * Pure sync-window filter for Amazon inbound shipments.
 * Isolated so tests can import the production implementation without Supabase/SP-API.
 */

export const TERMINAL_STATUSES = new Set([
  "CLOSED", "CANCELLED", "CANCELED", "DELETED", "ABANDONED", "ERROR",
]);

export const NON_TERMINAL_STATUSES = new Set([
  "UNCONFIRMED", "WORKING", "READY_TO_SHIP", "SHIPPED",
  "IN_TRANSIT", "DELIVERED", "CHECKED_IN", "RECEIVING",
]);

const TERMINAL_STATUSES_ALLOWED_FOR_CURRENT_YEAR = new Set(["CLOSED"]);

export type ResolvedShipmentDate = {
  iso: string | null;
  source:
    | "updated_at_amazon"
    | "created_at_amazon"
    | "raw.updatedAt"
    | "raw.lastUpdatedAt"
    | "raw.LastUpdatedDate"
    | "raw.updatedDate"
    | "raw.createdAt"
    | "raw.CreatedDate"
    | "raw.ShipmentCreatedDate"
    | "raw.shipmentCreatedDate"
    | "shipment_name"
    | "missing";
};

export type FilterableInboundShipment = {
  amazon_shipment_id: string | null;
  shipment_name: string | null;
  status: string | null;
  created_at_amazon: string | null;
  updated_at_amazon: string | null;
  raw?: unknown;
};

type RawRecord = Record<string, unknown>;

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

function timestamp(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resolveRawDate(raw: unknown, key: string): string | null {
  return timestamp(pick(raw, [key]));
}

function currentUtcYear(): number {
  return new Date().getUTCFullYear();
}

export function isTerminalStatus(status: string | null): boolean {
  const normalized = status?.trim().toUpperCase();
  return normalized ? TERMINAL_STATUSES.has(normalized) : false;
}

export function isCurrentYearAllowedTerminalStatus(status: string | null): boolean {
  const normalized = status?.trim().toUpperCase();
  return normalized ? TERMINAL_STATUSES_ALLOWED_FOR_CURRENT_YEAR.has(normalized) : false;
}

export function parseShipmentNameDate(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const match = text.match(/\((\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\)/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:00.000Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function resolveAmazonShipmentDate(
  shipment: FilterableInboundShipment,
): ResolvedShipmentDate {
  const raw = shipment.raw ?? null;
  const attempts: Array<[ResolvedShipmentDate["source"], string | null]> = [
    ["created_at_amazon", timestamp(shipment.created_at_amazon)],
    ["raw.createdAt", resolveRawDate(raw, "createdAt")],
    ["raw.CreatedDate", resolveRawDate(raw, "CreatedDate")],
    ["raw.ShipmentCreatedDate", resolveRawDate(raw, "ShipmentCreatedDate")],
    ["raw.shipmentCreatedDate", resolveRawDate(raw, "shipmentCreatedDate")],
    ["shipment_name", parseShipmentNameDate(shipment.shipment_name)],
    ["updated_at_amazon", timestamp(shipment.updated_at_amazon)],
    ["raw.updatedAt", resolveRawDate(raw, "updatedAt")],
    ["raw.lastUpdatedAt", resolveRawDate(raw, "lastUpdatedAt")],
    ["raw.LastUpdatedDate", resolveRawDate(raw, "LastUpdatedDate")],
    ["raw.updatedDate", resolveRawDate(raw, "updatedDate")],
  ];

  for (const [source, iso] of attempts) {
    if (iso) return { iso, source };
  }

  return { iso: null, source: "missing" };
}

/**
 * allowActiveWithoutDate is ignored for non-terminal shipments:
 * any operational status returned by Amazon is included even without a date.
 */
export function filterShipmentsForSync<T extends FilterableInboundShipment>(
  shipments: T[],
  lastUpdatedAfter: string,
  lastUpdatedBefore: string | null,
  includeClosed: boolean,
  includeClosedCurrentYear: boolean,
  allowActiveWithoutDate: boolean,
) {
  void allowActiveWithoutDate;
  const cutoff = new Date(lastUpdatedAfter).getTime();
  const maxTime = lastUpdatedBefore ? new Date(lastUpdatedBefore).getTime() : Number.NaN;
  let skippedByDate = 0;
  let skippedByStatus = 0;
  const skippedByMissingDate = 0;
  let dateResolvedFromRaw = 0;
  let dateResolvedFromShipmentName = 0;
  let activeWithoutDateImported = 0;
  const skippedByDateIds: string[] = [];
  const skippedByStatusIds: Array<{ id: string; status: string | null }> = [];
  const includedNonTerminalCarryoverIds: string[] = [];
  const ID_CAP = 20;

  const filtered: Array<{
    shipment: T;
    resolvedDate: ResolvedShipmentDate;
  }> = [];

  for (const shipment of shipments) {
    const resolvedDate = resolveAmazonShipmentDate(shipment);
    const statusIsTerminal = isTerminalStatus(shipment.status);
    const statusIsClosed = isCurrentYearAllowedTerminalStatus(shipment.status);
    const sid = shipment.amazon_shipment_id ?? "unknown";

    if (resolvedDate.source.startsWith("raw.")) dateResolvedFromRaw += 1;
    if (resolvedDate.source === "shipment_name") dateResolvedFromShipmentName += 1;

    if (resolvedDate.iso) {
      const time = new Date(resolvedDate.iso).getTime();
      if (statusIsTerminal && !Number.isNaN(cutoff) && time < cutoff) {
        skippedByDate += 1;
        if (skippedByDateIds.length < ID_CAP) skippedByDateIds.push(`${sid}(terminal,date=${resolvedDate.iso.slice(0, 10)})`);
        continue;
      }
      if (!Number.isNaN(maxTime) && time > maxTime) {
        skippedByDate += 1;
        if (skippedByDateIds.length < ID_CAP) skippedByDateIds.push(`${sid}(future,date=${resolvedDate.iso.slice(0, 10)})`);
        continue;
      }
    } else if (statusIsTerminal) {
      skippedByStatus += 1;
      if (skippedByStatusIds.length < ID_CAP) skippedByStatusIds.push({ id: sid, status: shipment.status });
      continue;
    } else {
      activeWithoutDateImported += 1;
    }

    if (statusIsTerminal && !statusIsClosed) {
      skippedByStatus += 1;
      if (skippedByStatusIds.length < ID_CAP) skippedByStatusIds.push({ id: sid, status: shipment.status });
      continue;
    }

    if (!includeClosed && !includeClosedCurrentYear && statusIsClosed) {
      skippedByStatus += 1;
      if (skippedByStatusIds.length < ID_CAP) skippedByStatusIds.push({ id: sid, status: shipment.status });
      continue;
    }

    if (!statusIsTerminal) {
      const dateYear = resolvedDate.iso ? new Date(resolvedDate.iso).getUTCFullYear() : null;
      const currentYear = currentUtcYear();
      if (dateYear !== null && dateYear < currentYear) {
        if (includedNonTerminalCarryoverIds.length < ID_CAP)
          includedNonTerminalCarryoverIds.push(`${sid}(${shipment.status},year=${dateYear})`);
      }
    }

    filtered.push({ shipment, resolvedDate });
  }

  return {
    shipments: filtered,
    skippedByDate,
    skippedByDateIds,
    skippedByStatus,
    skippedByStatusIds,
    skippedByMissingDate,
    dateResolvedFromRaw,
    dateResolvedFromShipmentName,
    activeWithoutDateImported,
    includedNonTerminalCarryoverIds,
  };
}
