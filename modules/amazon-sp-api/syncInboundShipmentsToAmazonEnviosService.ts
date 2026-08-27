/**
 * Modulo: Amazon SP-API.
 * Responsabilidad: sincronizar envios inbound ya creados en Seller Central
 * hacia `amazon_envios` y listar esas lineas agrupadas para vinculacion manual.
 * No debe crear envios Amazon, modificar contenedores, tocar stock ni forecast.
 */

import { buildAmazonInboundShipmentsDiagnostic } from "@/modules/amazon-sp-api/inboundShipmentsDiagnosticService";
import type {
  AmazonInboundShipmentDiagnostic,
  AmazonInboundShipmentItemDiagnostic,
} from "@/modules/amazon-sp-api/inboundShipmentsDiagnosticService";
import { extractTwinlySkuFromSellerSku } from "@/modules/imports/shared/twinlySku";
import {
  listLinkedOrdersForShipments,
  type ShipmentOrderLinkSummary,
} from "@/modules/amazon-sp-api/linkInboundShipmentOrderService";
import {
  loadAmazonInboundShipmentExtras,
  type AmazonInboundShipmentHeader,
} from "@/modules/amazon-sp-api/amazonInboundShipmentLogisticsService";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { resolveAmazonInboundLogisticsFlow } from "@/modules/amazon-sp-api/resolveAmazonInboundLogisticsFlow";
import {
  resolveAmazonShipmentVisibleLogistics,
  type AmazonShipmentVisibleLogistics,
} from "@/modules/amazon-sp-api/resolveAmazonShipmentVisibleLogistics";
import { spApiRequest } from "@/modules/amazon-sp-api/spApiClient";
import { supabaseAdmin } from "@/server/supabase/adminClient";

type RawRecord = Record<string, unknown>;

type ProductMatch = {
  productoId: string | null;
  matchedBy: string | null;
  skuLimpio: string | null;
  candidates: string[];
};

export type AmazonInboundProductSummary = {
  id: string;
  sku: string | null;
  nombre: string | null;
  imagen_url: string | null;
};

type ResolvedShipmentDate = {
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

export type SyncInboundShipmentsSummary = {
  diagnosticSource: string;
  shipmentsProcessed: number;
  linesUpserted: number;
  productsMatched: number;
  productsUnmatched: number;
  effectiveLastUpdatedAfter: string;
  effectiveLastUpdatedBefore: string | null;
  syncYear: number | null;
  includeClosedCurrentYear: boolean;
  includeReadyToShip: boolean;
  includeClosed: boolean;
  skippedByDate: number;
  skippedByStatus: number;
  skippedByMissingDate: number;
  dateResolvedFromRaw: number;
  dateResolvedFromShipmentName: number;
  activeWithoutDateImported: number;
  /** Non-destructive: cleanup removed. Always 0 now. */
  deletedUnlinkedRows: number;
  cleanupSkippedByExistingLinks: boolean;
  v2024RelationsMatched: number;
  v2024ShipmentsFetched: number;
  v2024TransportationOptionsRequests: number;
  v2024TransportationOptionsFetched: number;
  /** true only when all v2024 pages processed, no pending nextToken, no error, no cycle */
  acquisitionComplete: boolean;
  warnings: string[];
  errors: string[];
};

export type AmazonInboundShipmentListItem = {
  id: string | null;
  sku: string | null;
  seller_sku_original: string | null;
  sku_limpio: string | null;
  match_candidates: string[];
  matched_by: string | null;
  date_source: string | null;
  resolved_shipment_date: string | null;
  producto_id: string | null;
  producto: AmazonInboundProductSummary | null;
  cantidad_enviada: number;
  cantidad_recibida: number;
  cantidad_esperada: number;
  cantidad_localizada: number;
  link_status: string | null;
  link_confidence: number | null;
  raw: unknown;
};

export type AmazonInboundShipmentV0Details = {
  ship_from_name: string | null;
  ship_from_city: string | null;
  ship_from_district_or_county: string | null;
  ship_from_state_or_province_code: string | null;
  ship_from_country_code: string | null;
  destination_fulfillment_center_id: string | null;
  shipment_status: string | null;
  label_prep_type: string | null;
  box_contents_source: string | null;
};

export type AmazonInboundShipmentListGroup = {
  shipment_id: string;
  shipment_name: string | null;
  reference_id: string | null;
  inbound_plan_id: string | null;
  logistics_flow: string | null;
  transport_provider: string | null;
  estado: string | null;
  transport_status: string | null;
  destination_country: string | null;
  destination_center: string | null;
  fecha_creacion: string | null;
  fecha_cerrado: string | null;
  imported_at: string | null;
  date_source: string | null;
  resolved_shipment_date: string | null;
  /** Timestamp de creación en Amazon (separado de last_updated) */
  amazon_created_at: string | null;
  /** Timestamp de última actualización en Amazon */
  amazon_last_updated_at: string | null;
  /** Año del shipment basado en fecha de creación real (no actualización) */
  shipment_year: number | null;
  total_skus: number;
  total_cantidad_enviada: number;
  total_cantidad_recibida: number;
  total_cantidad_esperada: number;
  total_cantidad_localizada: number;
  /** Discrepancia: cantidad_enviada - cantidad_recibida (informativo) */
  total_discrepancy_quantity: number;
  productsMatched: number;
  productsUnmatched: number;
  contenedor_id: string | null;
  link_status: string | null;
  link_confidence: number | null;
  /** true si el shipment requiere revisión (estado desconocido, MIXED, o CLOSED con discrepancia) */
  review_required: boolean;
  visible_logistics: AmazonShipmentVisibleLogistics;
  header: AmazonInboundShipmentHeader | null;
  documents_count: number;
  costs_count: number;
  costs_total: number;
  amazon_v0: AmazonInboundShipmentV0Details;
  linked_orders: ShipmentOrderLinkSummary[];
  items: AmazonInboundShipmentListItem[];
};

type LinkedContainerSummary = {
  id: string;
  identificador_embarque: string | null;
  fecha_eta_estimada: string | null;
  fecha_salida: string | null;
};

type V2024EnrichmentSummary = {
  searchedShipmentIds: string[];
  plansScanned: number;
  plansRead: number;
  inboundPlanPagesScanned: number;
  internalShipmentsChecked: number;
  getInboundPlanCalls: number;
  getShipmentCalls: number;
  relationsMatched: number;
  enriched: string[];
  notFound: string[];
  shipmentsFetched: number;
  transportationOptionsRequests: number;
  transportationOptionsFetched: number;
  quotaExceededCount: number;
  endpointErrors: Array<{
    endpoint: string;
    status?: number;
    message: string;
    details?: unknown;
  }>;
  warnings: string[];
  /** true solo si: todas las páginas procesadas, sin nextToken pendiente, sin error, sin ciclo */
  acquisitionComplete: boolean;
};

export type V2024DirectedEnrichmentResult = V2024EnrichmentSummary & {
  shipmentId: string;
  force: boolean;
};

export type AmazonInboundShipmentListResult = {
  shipments: AmazonInboundShipmentListGroup[];
  closedCount: number;
  hiddenClosedCount: number;
  mode: "operative" | "history";
  /** Año aplicado en mode=history */
  historyYear?: number;
  totalCount: number;
};

const MIN_SYNC_FROM_DATE = "2020-01-01";

// Terminales: shipment no volverá a estado activo
const TERMINAL_STATUSES = new Set([
  "CLOSED", "CANCELLED", "CANCELED", "DELETED", "ABANDONED", "ERROR",
]);
// Alias backward-compat — misma referencia
const CLOSED_STATUSES = TERMINAL_STATUSES;

// No terminales confirmados
const NON_TERMINAL_STATUSES = new Set([
  "UNCONFIRMED", "WORKING", "READY_TO_SHIP", "SHIPPED",
  "IN_TRANSIT", "DELIVERED", "CHECKED_IN", "RECEIVING",
]);

// MIXED es modalidad especial: no asumir terminal
const SPECIAL_STATUSES = new Set(["MIXED"]);

// Todos los estados conocidos
const ALL_KNOWN_STATUSES = new Set([
  ...Array.from(NON_TERMINAL_STATUSES),
  ...Array.from(TERMINAL_STATUSES),
  ...Array.from(SPECIAL_STATUSES),
]);

// Solo CLOSED está permitido como terminal en año actual (visible en operativo)
const TERMINAL_STATUSES_ALLOWED_FOR_CURRENT_YEAR = new Set(["CLOSED"]);

const V2024_MAX_PAGE_SIZE = 30;
const V2024_NORMAL_MAX_PAGES = 3;
// Límite absoluto para paginación completa — fail-closed si se supera
const V2024_ABSOLUTE_MAX_PAGES = 50;

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

function dateOnly(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text.slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function timestamp(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function parseShipmentNameDate(value: unknown): string | null {
  const text = str(value);
  if (!text) return null;
  const match = text.match(/\((\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\)/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:00.000Z`;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resolveRawDate(raw: unknown, key: string): string | null {
  return timestamp(pick(raw, [key]));
}

/**
 * Resuelve la fecha del shipment priorizando fechas de CREACIÓN sobre actualización.
 * Un shipment creado en 2024 NO se reclasifica como 2026 solo porque Amazon lo actualizó.
 */
export function resolveAmazonShipmentDate(
  shipment: AmazonInboundShipmentDiagnostic,
): ResolvedShipmentDate {
  const raw = shipment.raw ?? null;
  // Prioridad: fechas de creación primero, actualización solo como fallback final
  const attempts: Array<[ResolvedShipmentDate["source"], string | null]> = [
    ["created_at_amazon", timestamp(shipment.created_at_amazon)],
    ["raw.createdAt", resolveRawDate(raw, "createdAt")],
    ["raw.CreatedDate", resolveRawDate(raw, "CreatedDate")],
    ["raw.ShipmentCreatedDate", resolveRawDate(raw, "ShipmentCreatedDate")],
    ["raw.shipmentCreatedDate", resolveRawDate(raw, "shipmentCreatedDate")],
    ["shipment_name", parseShipmentNameDate(shipment.shipment_name)],
    // Fallback a fecha de actualización solo si no hay fecha de creación
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

/** Resuelve exclusivamente la fecha de CREACIÓN Amazon. */
function resolveAmazonCreatedAt(shipment: AmazonInboundShipmentDiagnostic): string | null {
  const raw = shipment.raw ?? null;
  return (
    timestamp(shipment.created_at_amazon) ??
    resolveRawDate(raw, "createdAt") ??
    resolveRawDate(raw, "CreatedDate") ??
    resolveRawDate(raw, "ShipmentCreatedDate") ??
    resolveRawDate(raw, "shipmentCreatedDate") ??
    parseShipmentNameDate(shipment.shipment_name)
  );
}

/** Resuelve exclusivamente la fecha de ÚLTIMA ACTUALIZACIÓN Amazon. */
function resolveAmazonLastUpdatedAt(shipment: AmazonInboundShipmentDiagnostic): string | null {
  const raw = shipment.raw ?? null;
  return (
    timestamp(shipment.updated_at_amazon) ??
    resolveRawDate(raw, "updatedAt") ??
    resolveRawDate(raw, "lastUpdatedAt") ??
    resolveRawDate(raw, "LastUpdatedDate") ??
    resolveRawDate(raw, "updatedDate")
  );
}

/** Devuelve true si el estado es desconocido (no está en la lista de estados soportados). */
function isUnknownStatus(status: string | null): boolean {
  if (!status) return false;
  const normalized = status.trim().toUpperCase();
  return !ALL_KNOWN_STATUSES.has(normalized);
}

/** Calcula review_required para un shipment según su estado y discrepancia. */
function computeReviewRequired(status: string | null, discrepancyQty: number): boolean {
  const normalized = status?.trim().toUpperCase() ?? null;
  if (!normalized) return false;
  if (isUnknownStatus(normalized)) return true;
  if (normalized === "MIXED") return true;
  if (normalized === "CLOSED" && discrepancyQty > 0) return true;
  return false;
}

function dateAtUtcStart(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function resolveEffectiveFromDate(fromDate?: string | null): string {
  const minDate = dateAtUtcStart(MIN_SYNC_FROM_DATE);
  const requestedText = str(fromDate);
  if (!requestedText) return minDate.toISOString();

  const requested = new Date(requestedText);
  if (Number.isNaN(requested.getTime())) return minDate.toISOString();
  return requested > minDate ? requested.toISOString() : minDate.toISOString();
}

function currentUtcYear(): number {
  return new Date().getUTCFullYear();
}

function normalizeYear(value: unknown): number | null {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2020 || year > 2100) return null;
  return year;
}

function resolveSyncWindow(params: {
  year?: number | null;
  fromDate?: string | null;
  toDate?: string | null;
}): {
  year: number | null;
  fromDate: string;
  toDate: string | null;
} {
  const year = normalizeYear(params.year);
  if (year) {
    return {
      year,
      fromDate: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)).toISOString(),
      toDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999)).toISOString(),
    };
  }

  const fromDate = resolveEffectiveFromDate(params.fromDate);
  const parsedToDate = timestamp(params.toDate);
  return {
    year: null,
    fromDate,
    toDate: parsedToDate,
  };
}

function dateFallsInYear(value: string | null, year: number): boolean {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() === year;
}

function resolvedShipmentTimestamp(
  shipment: Pick<
    AmazonInboundShipmentListGroup,
    "resolved_shipment_date" | "fecha_creacion" | "imported_at" | "shipment_name"
  >,
): string | null {
  return (
    timestamp(shipment.resolved_shipment_date) ??
    timestamp(shipment.fecha_creacion) ??
    parseShipmentNameDate(shipment.shipment_name) ??
    timestamp(shipment.imported_at)
  );
}

function normalizeSkuToken(value: string | null): string | null {
  const text = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[#\s-]+/g, "")
    .replace(/[^A-Z0-9]/g, "");
  return text || null;
}

function digitsOnly(value: string | null): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function pushCandidate(candidates: string[], value: string | null) {
  const text = String(value ?? "").trim();
  if (text && !candidates.includes(text)) candidates.push(text);
}

function buildSkuCandidates(sku: string | null): {
  skuLimpio: string | null;
  candidates: string[];
} {
  const candidates: string[] = [];
  const original = str(sku);
  const normalized = normalizeSkuToken(original);
  const twinlySku = original ? extractTwinlySkuFromSellerSku(original) : null;
  const digits = digitsOnly(original);
  const eanMatches = normalized?.match(/\d{13}/g) ?? [];

  pushCandidate(candidates, original);
  pushCandidate(candidates, normalized);
  pushCandidate(candidates, twinlySku);
  for (const ean of eanMatches) pushCandidate(candidates, ean);
  pushCandidate(candidates, digits);

  return {
    skuLimpio: twinlySku ?? eanMatches[0] ?? normalized ?? digits ?? original,
    candidates,
  };
}

function normalizeComparable(value: unknown): string | null {
  return normalizeSkuToken(str(value));
}

function isClosedStatus(status: string | null): boolean {
  const normalized = status?.trim().toUpperCase();
  return normalized ? TERMINAL_STATUSES.has(normalized) : false;
}

function isTerminalStatus(status: string | null): boolean {
  const normalized = status?.trim().toUpperCase();
  return normalized ? TERMINAL_STATUSES.has(normalized) : false;
}

function isCurrentYearAllowedTerminalStatus(status: string | null): boolean {
  const normalized = status?.trim().toUpperCase();
  return normalized ? TERMINAL_STATUSES_ALLOWED_FOR_CURRENT_YEAR.has(normalized) : false;
}

/** MIXED no es terminal — no asumir como cerrado. */
function isMixedStatus(status: string | null): boolean {
  return status?.trim().toUpperCase() === "MIXED";
}

function filterShipmentsForSync(
  shipments: AmazonInboundShipmentDiagnostic[],
  lastUpdatedAfter: string,
  lastUpdatedBefore: string | null,
  includeClosed: boolean,
  includeClosedCurrentYear: boolean,
  allowActiveWithoutDate: boolean,
) {
  const cutoff = new Date(lastUpdatedAfter).getTime();
  const maxTime = lastUpdatedBefore ? new Date(lastUpdatedBefore).getTime() : Number.NaN;
  let skippedByDate = 0;
  let skippedByStatus = 0;
  let skippedByMissingDate = 0;
  let dateResolvedFromRaw = 0;
  let dateResolvedFromShipmentName = 0;
  let activeWithoutDateImported = 0;

  const filtered: Array<{
    shipment: AmazonInboundShipmentDiagnostic;
    resolvedDate: ResolvedShipmentDate;
  }> = [];

  for (const shipment of shipments) {
    const resolvedDate = resolveAmazonShipmentDate(shipment);
    const statusIsTerminal = isTerminalStatus(shipment.status);
    const statusIsClosed = isCurrentYearAllowedTerminalStatus(shipment.status);

    if (resolvedDate.source.startsWith("raw.")) dateResolvedFromRaw += 1;
    if (resolvedDate.source === "shipment_name") dateResolvedFromShipmentName += 1;

    if (resolvedDate.iso) {
      const time = new Date(resolvedDate.iso).getTime();
      if (!Number.isNaN(cutoff) && time < cutoff) {
        skippedByDate += 1;
        continue;
      }
      if (!Number.isNaN(maxTime) && time > maxTime) {
        skippedByDate += 1;
        continue;
      }
    } else if (statusIsTerminal) {
      skippedByStatus += 1;
      continue;
    } else if (allowActiveWithoutDate) {
      activeWithoutDateImported += 1;
    } else {
      skippedByMissingDate += 1;
      continue;
    }

    if (statusIsTerminal && !statusIsClosed) {
      skippedByStatus += 1;
      continue;
    }

    if (!includeClosed && !includeClosedCurrentYear && statusIsClosed) {
      skippedByStatus += 1;
      continue;
    }

    filtered.push({ shipment, resolvedDate });
  }

  return {
    shipments: filtered,
    skippedByDate,
    skippedByStatus,
    skippedByMissingDate,
    dateResolvedFromRaw,
    dateResolvedFromShipmentName,
    activeWithoutDateImported,
  };
}

function resolveItemSku(item: AmazonInboundShipmentItemDiagnostic): string | null {
  return item.seller_sku ?? item.sku_limpio ?? null;
}

function itemKey(params: {
  shipment: AmazonInboundShipmentDiagnostic;
  item: AmazonInboundShipmentItemDiagnostic;
  index: number;
}) {
  return `${params.shipment.amazon_shipment_id ?? "sin-shipment"}::${params.index}::${
    resolveItemSku(params.item) ?? ""
  }`;
}

async function resolveProductMatches(
  shipments: AmazonInboundShipmentDiagnostic[],
  warnings: string[],
): Promise<Map<string, ProductMatch>> {
  const byItemKey = new Map<string, ProductMatch>();
  const allCandidates = new Set<string>();
  const itemCandidates = new Map<string, { skuLimpio: string | null; candidates: string[] }>();

  for (const shipment of shipments) {
    shipment.items.forEach((item, index) => {
      const built = buildSkuCandidates(resolveItemSku(item));
      const key = itemKey({ shipment, item, index });
      itemCandidates.set(key, built);
      for (const candidate of built.candidates) allCandidates.add(candidate);
    });
  }

  const candidates = Array.from(allCandidates);
  const productByCandidate = new Map<string, { id: string; matchedBy: string }>();

  if (candidates.length > 0) {
    const { data: products, error: productError } = await supabaseAdmin
      .from("productos")
      .select("id, sku")
      .in("sku", candidates);

    if (productError) throw new Error(productError.message);

    for (const row of products ?? []) {
      const id = str((row as RawRecord).id);
      const sku = str((row as RawRecord).sku);
      if (!id || !sku) continue;
      productByCandidate.set(sku, { id, matchedBy: "productos.sku" });
      const normalized = normalizeComparable(sku);
      if (normalized) {
        productByCandidate.set(normalized, {
          id,
          matchedBy: "productos.sku_normalizado",
        });
      }
    }

    const { data: logistics, error: logisticsError } = await supabaseAdmin
      .from("producto_logistica")
      .select("producto_id, ean_upc")
      .in("ean_upc", candidates);

    if (logisticsError) throw new Error(logisticsError.message);

    for (const row of logistics ?? []) {
      const id = str((row as RawRecord).producto_id);
      const ean = str((row as RawRecord).ean_upc);
      if (!id || !ean) continue;
      productByCandidate.set(ean, { id, matchedBy: "producto_logistica.ean_upc" });
      const normalized = normalizeComparable(ean);
      if (normalized) {
        productByCandidate.set(normalized, {
          id,
          matchedBy: "producto_logistica.ean_upc_normalizado",
        });
      }
    }
  }

  for (const [key, built] of Array.from(itemCandidates.entries())) {
    let match: ProductMatch = {
      productoId: null,
      matchedBy: null,
      skuLimpio: built.skuLimpio,
      candidates: built.candidates,
    };

    for (const candidate of built.candidates) {
      const found =
        productByCandidate.get(candidate) ??
        productByCandidate.get(normalizeComparable(candidate) ?? "");
      if (found) {
        match = {
          productoId: found.id,
          matchedBy: found.matchedBy,
          skuLimpio: built.skuLimpio,
          candidates: built.candidates,
        };
        break;
      }
    }

    if (!match.productoId) {
      warnings.push(
        `Sin match de producto para SKU inbound: ${built.candidates[0] ?? "sin SKU"}.`,
      );
    }
    byItemKey.set(key, match);
  }

  return byItemKey;
}

function mapInboundItemToAmazonEnvioRow(params: {
  shipment: AmazonInboundShipmentDiagnostic;
  item: AmazonInboundShipmentItemDiagnostic;
  userId: string | null;
  match: ProductMatch;
  resolvedDate: ResolvedShipmentDate;
}) {
  const { shipment, item, userId, match, resolvedDate } = params;
  const itemRaw = asRecord(item.raw);
  const shipmentRaw = asRecord(shipment.raw);
  const sku = resolveItemSku(item);

  // Semántica separada:
  // cantidad_esperada = planificada (v2024 expected / quantity field)
  // cantidad_enviada  = realmente enviada (v0 QuantityShipped)
  // cantidad_recibida = realmente recibida (v0 QuantityReceived)
  const expectedQty = num(item.expected_quantity);
  const receivedQty = num(item.received_quantity);
  const locatedQty = num(item.located_quantity);

  // QuantityShipped viene de v0 — diferente de expected (planificado)
  const rawQuantityShipped = pick(itemRaw, ["QuantityShipped", "quantityShipped"]);
  const shippedQty = rawQuantityShipped != null ? num(rawQuantityShipped) : expectedQty;

  // Discrepancia informativa: solo cuando hay datos de envío y recepción
  const discrepancyQty =
    shippedQty > 0 || receivedQty > 0 ? Math.max(0, shippedQty - receivedQty) : 0;

  // Fechas Amazon separadas
  const amazonCreatedAt = resolveAmazonCreatedAt(shipment);
  const amazonLastUpdatedAt = resolveAmazonLastUpdatedAt(shipment);
  const syncedAt = new Date().toISOString();

  // review_required calculado por estado y discrepancia
  const reviewRequired = computeReviewRequired(shipment.status, discrepancyQty);

  // Estado desconocido: conservar raw, no transformar
  const statusNormalized = shipment.status?.trim().toUpperCase() ?? null;
  const statusIsUnknown = isUnknownStatus(shipment.status);

  return {
    shipment_id: shipment.amazon_shipment_id,
    shipment_name: shipment.shipment_name,
    reference_id: shipment.amazon_reference_id,
    inbound_plan_id: shipment.amazon_inbound_plan_id,
    sku,
    fnsku: str(pick(itemRaw, ["fnsku", "FNSKU", "fulfillmentNetworkSku"])),
    asin: str(pick(itemRaw, ["asin", "ASIN"])),
    producto_id: match.productoId,
    // cantidad_esperada = planificado; cantidad_enviada = QuantityShipped v0
    cantidad_enviada: shippedQty,
    cantidad_recibida: receivedQty,
    cantidad_esperada: expectedQty,
    cantidad_localizada: locatedQty,
    destination_country: str(
      pick(shipmentRaw, ["destinationCountry", "DestinationCountry", "countryCode"]),
    ),
    destination_center: shipment.destination_fc,
    fecha_creacion: dateOnly(resolvedDate.iso),
    fecha_cerrado: dateOnly(
      pick(shipmentRaw, ["closedAt", "closedDate", "ClosedDate", "shipmentClosedDate"]),
    ),
    estado: shipment.status,
    transport_status: str(
      pick(shipmentRaw, ["transportStatus", "TransportStatus", "shipmentTransportStatus"]),
    ),
    matched_by: match.matchedBy,
    source: "sp_api_inbound",
    raw: {
      shipment: shipment.raw ?? null,
      item: item.raw ?? null,
      seller_sku_original: item.seller_sku ?? sku,
      sku_limpio: match.skuLimpio,
      match_candidates: match.candidates,
      matched_by: match.matchedBy,
      date_source: resolvedDate.source,
      resolved_shipment_date: resolvedDate.iso,
      // Fechas separadas: creación vs actualización Amazon
      amazon_created_at: amazonCreatedAt,
      amazon_last_updated_at: amazonLastUpdatedAt,
      synced_at: syncedAt,
      // Compat legacy
      created_at_amazon: shipment.created_at_amazon,
      updated_at_amazon: shipment.updated_at_amazon,
      raw_shipment_name: shipment.shipment_name,
      raw_status: shipment.status,
      status_normalized: statusNormalized,
      status_is_unknown: statusIsUnknown,
      // Cantidades semánticamente separadas
      quantity_expected: expectedQty,
      quantity_shipped: shippedQty,
      quantity_received: receivedQty,
      quantity_discrepancy: discrepancyQty,
      // Review flag
      review_required: reviewRequired,
    },
    imported_at: syncedAt,
    imported_by: userId,
  };
}

function mapInboundShipmentHeaderRow(params: {
  shipment: AmazonInboundShipmentDiagnostic;
  resolvedDate: ResolvedShipmentDate;
  existingLogisticsFlow?: string | null;
  existingTransportProvider?: string | null;
}) {
  const { shipment, resolvedDate } = params;
  const raw = asRecord(shipment.raw);
  const shipFromAddress = asRecord(pick(raw, ["ShipFromAddress", "shipFromAddress"]));
  const row: RawRecord = {
    shipment_id: shipment.amazon_shipment_id,
    shipment_name: shipment.shipment_name,
    estado_amazon: shipment.status,
    destination_center: shipment.destination_fc,
    destination_country: str(
      pick(raw, ["destinationCountry", "DestinationCountry", "countryCode"]),
    ),
    fecha_creacion_resuelta: resolvedDate.iso,
    date_source: resolvedDate.source,
    transport_status: str(
      pick(raw, ["transportStatus", "TransportStatus", "shipmentTransportStatus"]),
    ),
    raw: shipment.raw ?? null,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (!params.existingLogisticsFlow) {
    row.logistics_flow = resolveAmazonInboundLogisticsFlow(shipFromAddress);
  }
  if (!params.existingTransportProvider) {
    row.transport_provider = "propio";
  }

  return row;
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

function nextTokenFrom(value: unknown): string | null {
  return str(
    pick(value, ["nextToken", "NextToken"]) ??
      pick(asRecord(pick(value, ["pagination"])), ["nextToken", "NextToken"]) ??
      pick(asRecord(pick(value, ["payload"])), ["nextToken", "NextToken"]),
  );
}

function createV2024Summary(searchedShipmentIds: string[]): V2024EnrichmentSummary {
  return {
    searchedShipmentIds,
    plansScanned: 0,
    plansRead: 0,
    inboundPlanPagesScanned: 0,
    internalShipmentsChecked: 0,
    getInboundPlanCalls: 0,
    getShipmentCalls: 0,
    relationsMatched: 0,
    enriched: [],
    notFound: [],
    shipmentsFetched: 0,
    transportationOptionsRequests: 0,
    transportationOptionsFetched: 0,
    quotaExceededCount: 0,
    endpointErrors: [],
    warnings: [],
    // false hasta que se confirme que todas las páginas fueron procesadas sin error ni ciclo
    acquisitionComplete: false,
  };
}

function appendV2024Error(
  summary: V2024EnrichmentSummary,
  endpoint: string,
  error: unknown,
  warnings?: string[],
) {
  const mapped = mapGenericError(error);
  if (mapped.status === 429 || mapped.code === "rate_limited") {
    summary.quotaExceededCount += 1;
  }
  const entry = {
    endpoint,
    status: mapped.status,
    message: mapped.message,
    details: mapped.details,
  };
  summary.endpointErrors.push(entry);
  summary.warnings.push(`${endpoint}: ${mapped.message}`);
  warnings?.push(`${endpoint}: ${mapped.message}`);
}

function isQuotaError(error: unknown): boolean {
  const mapped = mapGenericError(error);
  return mapped.status === 429 || mapped.code === "rate_limited";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function spApiRequestWithQuotaRetry<T>(
  summary: V2024EnrichmentSummary,
  endpoint: string,
  fn: () => Promise<T>,
  options?: {
    delayMs?: number;
    retries?: number;
    warnings?: string[];
  },
): Promise<T | null> {
  const retries = Math.max(0, options?.retries ?? 0);
  const delayMs = Math.max(0, options?.delayMs ?? 0);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      appendV2024Error(summary, endpoint, error, options?.warnings);
      if (!isQuotaError(error) || attempt >= retries) return null;
      if (delayMs > 0) await sleep(delayMs * (attempt + 1));
    }
  }

  return null;
}

async function fetchV2024InboundPlansPage(nextToken: string | null): Promise<{
  plans: RawRecord[];
  nextToken: string | null;
}> {
  const response = await spApiRequest<unknown>({
    method: "GET",
    path: "/inbound/fba/2024-03-20/inboundPlans",
    query: {
      pageSize: String(V2024_MAX_PAGE_SIZE),
      paginationToken: nextToken ?? undefined,
    },
  });

  return {
    plans: arrayFrom(response, ["inboundPlans", "plans"]).map(asRecord),
    nextToken: nextTokenFrom(response),
  };
}

async function fetchPersistedAmazonShipmentIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("amazon_envios")
    .select("shipment_id")
    .not("shipment_id", "is", null)
    .limit(5000);

  if (error) throw new Error(error.message);

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => str((row as RawRecord).shipment_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
}

function extractV2024ShipmentConfirmationId(shipment: RawRecord): string | null {
  return str(pick(shipment, ["shipmentConfirmationId", "ShipmentConfirmationId"]));
}

function extractV2024ShipmentId(shipment: RawRecord): string | null {
  return str(pick(shipment, ["shipmentId", "ShipmentId", "id"]));
}

function extractV2024AmazonReferenceId(shipment: RawRecord): string | null {
  return str(pick(shipment, ["amazonReferenceId", "referenceId", "ReferenceId"]));
}

function resolveExplicitDate(raw: unknown, keys: string[]): string | null {
  const record = asRecord(raw);
  for (const key of keys) {
    const value = timestamp(record[key]);
    if (value) return value.slice(0, 10);
  }
  return null;
}

function resolveExplicitEtaFromShipment(rawShipment: RawRecord): string | null {
  const dates = asRecord(rawShipment.dates);
  return resolveExplicitDate(dates, [
    "estimatedDeliveryDate",
    "estimatedArrivalDate",
    "deliveryDate",
    "arrivalDate",
  ]);
}

function resolveExplicitShipDateFromShipment(rawShipment: RawRecord): string | null {
  const dates = asRecord(rawShipment.dates);
  return resolveExplicitDate(dates, [
    "shipDate",
    "estimatedShipDate",
    "readyToShipDate",
    "pickupDate",
  ]);
}

function resolveCarrierFromTransportationOptions(options: RawRecord[]): string | null {
  for (const option of options) {
    const carrier =
      str(pick(option, ["carrierName", "carrier", "shippingCarrier"])) ??
      str(pick(asRecord(option.carrier), ["name", "carrierName"]));
    if (carrier) return carrier;
  }
  return null;
}

async function persistV2024Match(params: {
  summary: V2024EnrichmentSummary;
  inboundPlanId: string;
  shipmentConfirmationId: string;
  internalShipmentId: string | null;
  rawShipmentRef: RawRecord | null;
  shipmentDetail: RawRecord | null;
  warnings?: string[];
  fetchTransportationOptions: boolean;
}): Promise<void> {
  const detail = params.shipmentDetail ?? params.rawShipmentRef ?? {};
  const amazonReferenceId =
    extractV2024AmazonReferenceId(detail) ??
    extractV2024AmazonReferenceId(params.rawShipmentRef ?? {});
  const placementOptionId = str(pick(detail, ["placementOptionId"]));
  const acceptedTransportationSelection = asRecord(
    pick(detail, ["acceptedTransportationSelection"]),
  );
  const etaEstimada = resolveExplicitEtaFromShipment(detail);
  const fechaSalida = resolveExplicitShipDateFromShipment(detail);
  let transportationOptions: RawRecord[] = [];

  if (params.fetchTransportationOptions && params.internalShipmentId) {
    params.summary.transportationOptionsRequests += 1;
    const transportationResponse = await spApiRequestWithQuotaRetry(
      params.summary,
      `v2024 transportationOptions ${params.inboundPlanId}/${params.internalShipmentId}`,
      () =>
        spApiRequest<unknown>({
          method: "GET",
          path: `/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(
            params.inboundPlanId,
          )}/transportationOptions`,
          query: { shipmentId: params.internalShipmentId ?? undefined },
        }),
      { warnings: params.warnings },
    );
    if (transportationResponse) {
      transportationOptions = arrayFrom(transportationResponse, [
        "transportationOptions",
      ]).map(asRecord);
      params.summary.transportationOptionsFetched += transportationOptions.length;
    }
  }

  const updatePayload: RawRecord = {
    inbound_plan_id: params.inboundPlanId,
    amazon_shipment_id: params.internalShipmentId,
    amazon_reference_id: amazonReferenceId,
    v2024_enrichment: {
      inboundPlanId: params.inboundPlanId,
      shipmentId: params.internalShipmentId,
      shipmentConfirmationId: params.shipmentConfirmationId,
      amazonReferenceId,
      placementOptionId,
      acceptedTransportationSelection:
        Object.keys(acceptedTransportationSelection).length > 0
          ? acceptedTransportationSelection
          : null,
      shipment: params.shipmentDetail,
      shipmentReference: params.rawShipmentRef,
      transportationOptions,
      enrichedAt: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  };

  if (etaEstimada) updatePayload.eta_estimada = etaEstimada;
  if (fechaSalida) updatePayload.fecha_salida = fechaSalida;
  const carrier = resolveCarrierFromTransportationOptions(transportationOptions);
  if (carrier) updatePayload.carrier = carrier;

  const { data, error: updateError } = await supabaseAdmin
    .from("amazon_inbound_shipments")
    .update(updatePayload)
    .eq("shipment_id", params.shipmentConfirmationId)
    .select("shipment_id");

  if (updateError) {
    const message = `No se pudo guardar relacion v2024 ${params.shipmentConfirmationId}: ${updateError.message}`;
    params.summary.endpointErrors.push({
      endpoint: `supabase amazon_inbound_shipments update ${params.shipmentConfirmationId}`,
      message,
      details: updateError,
    });
    params.summary.warnings.push(message);
    params.warnings?.push(message);
    return;
  }

  if (!data || data.length === 0) {
    const message = `No se pudo guardar relacion v2024 ${params.shipmentConfirmationId}: UPDATE sin filas afectadas.`;
    params.summary.endpointErrors.push({
      endpoint: `supabase amazon_inbound_shipments update ${params.shipmentConfirmationId}`,
      message,
    });
    params.summary.warnings.push(message);
    params.warnings?.push(message);
    return;
  }

  params.summary.relationsMatched += 1;
  params.summary.enriched.push(params.shipmentConfirmationId);
}

async function persistV2024DirectedAttemptStatus(
  shipmentId: string,
  summary: V2024EnrichmentSummary,
) {
  if (summary.enriched.includes(shipmentId)) return;

  const v2024Status = summary.quotaExceededCount > 0 ? "quota_exceeded" : "not_found";
  const { error } = await supabaseAdmin
    .from("amazon_inbound_shipments")
    .update({
      v2024_enrichment: {
        v2024Status,
        searchedShipmentIds: summary.searchedShipmentIds,
        inboundPlanPagesScanned: summary.inboundPlanPagesScanned,
        plansScanned: summary.plansScanned,
        plansRead: summary.plansRead,
        internalShipmentsChecked: summary.internalShipmentsChecked,
        getInboundPlanCalls: summary.getInboundPlanCalls,
        getShipmentCalls: summary.getShipmentCalls,
        transportationOptionsRequests: summary.transportationOptionsRequests,
        transportationOptionsFetched: summary.transportationOptionsFetched,
        quotaExceededCount: summary.quotaExceededCount,
        endpointErrors: summary.endpointErrors.slice(-10),
        enrichedAt: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("shipment_id", shipmentId);

  if (error) {
    summary.endpointErrors.push({
      endpoint: `supabase amazon_inbound_shipments diagnostic update ${shipmentId}`,
      message: error.message,
      details: error,
    });
    summary.warnings.push(
      `No se pudo guardar estado diagnostico v2024 ${shipmentId}: ${error.message}`,
    );
  }
}

async function enrichPersistedShipmentsWithV2024(
  warnings: string[],
  options?: { maxPages?: number },
): Promise<V2024EnrichmentSummary> {
  const persistedShipmentIds = new Set(await fetchPersistedAmazonShipmentIds());
  const summary = createV2024Summary(Array.from(persistedShipmentIds));
  if (persistedShipmentIds.size === 0) {
    summary.acquisitionComplete = true;
    return summary;
  }

  const found = new Set<string>();
  let nextToken: string | null = null;
  // Tokens vistos: para detectar ciclos
  const seenTokens = new Set<string>();
  // Límite: nunca superar V2024_ABSOLUTE_MAX_PAGES
  const maxPages = Math.max(1, Math.min(options?.maxPages ?? V2024_NORMAL_MAX_PAGES, V2024_ABSOLUTE_MAX_PAGES));
  let hadError = false;
  let cycleDetected = false;

  for (let page = 0; page < maxPages; page += 1) {
    const pageResult = await spApiRequestWithQuotaRetry(
      summary,
      "v2024 listInboundPlans",
      () => fetchV2024InboundPlansPage(nextToken),
      { warnings },
    );

    // fail-closed: cualquier error de página detiene la adquisición
    if (!pageResult) {
      hadError = true;
      warnings.push(`v2024 paginación: error en página ${page + 1} — acquisitionComplete=false`);
      break;
    }

    summary.inboundPlanPagesScanned += 1;
    summary.plansScanned += pageResult.plans.length;
    const newToken = pageResult.nextToken;

    for (const plan of pageResult.plans) {
      const inboundPlanId = str(pick(plan, ["inboundPlanId", "id", "planId"]));
      if (!inboundPlanId) continue;

      summary.getInboundPlanCalls += 1;
      const planDetail = await spApiRequestWithQuotaRetry(
        summary,
        `v2024 getInboundPlan ${inboundPlanId}`,
        () =>
          spApiRequest<unknown>({
            method: "GET",
            path: `/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(
              inboundPlanId,
            )}`,
          }),
        { warnings },
      );
      if (!planDetail) {
        if (summary.quotaExceededCount > 0) {
          hadError = true;
          break;
        }
        continue;
      }
      summary.plansRead += 1;

      for (const rawShipmentRef of arrayFrom(planDetail, ["shipments"]).map(asRecord)) {
        summary.internalShipmentsChecked += 1;
        const shipmentConfirmationId =
          extractV2024ShipmentConfirmationId(rawShipmentRef);
        if (!shipmentConfirmationId || !persistedShipmentIds.has(shipmentConfirmationId)) {
          continue;
        }

        found.add(shipmentConfirmationId);
        await persistV2024Match({
          summary,
          inboundPlanId,
          shipmentConfirmationId,
          internalShipmentId: extractV2024ShipmentId(rawShipmentRef),
          rawShipmentRef,
          shipmentDetail: null,
          warnings,
          fetchTransportationOptions: false,
        });
      }

      if (hadError) break;
    }

    if (hadError) break;

    // Sin más páginas — adquisición completa si no hubo error
    if (!newToken) {
      summary.acquisitionComplete = !hadError && !cycleDetected;
      break;
    }

    // Detección de token repetido / ciclo — abort seguro
    if (seenTokens.has(newToken)) {
      cycleDetected = true;
      warnings.push(`v2024 paginación: ciclo detectado (token repetido) — acquisitionComplete=false`);
      break;
    }
    seenTokens.add(newToken);
    nextToken = newToken;
  }

  // Si salimos del loop por haber alcanzado maxPages con token pendiente
  if (!summary.acquisitionComplete && !hadError && !cycleDetected && nextToken) {
    warnings.push(`v2024 paginación: límite de páginas (${maxPages}) alcanzado con nextToken pendiente`);
  }

  summary.notFound = Array.from(persistedShipmentIds).filter((id) => !found.has(id));
  return summary;
}

export async function enrichAmazonInboundShipmentV2024Directed(params: {
  shipmentId: string;
  maxPages?: number;
  delayMs?: number;
  force?: boolean;
}): Promise<V2024DirectedEnrichmentResult> {
  const targetShipmentId = params.shipmentId.trim();
  const summary = createV2024Summary([targetShipmentId]);
  const maxPages = Math.max(1, Math.min(params.maxPages ?? 100, 100));
  const delayMs = Math.max(0, params.delayMs ?? 1000);
  const found = new Set<string>();

  const { data: header, error: headerError } = await supabaseAdmin
    .from("amazon_inbound_shipments")
    .select("shipment_id, inbound_plan_id, amazon_shipment_id")
    .eq("shipment_id", targetShipmentId)
    .maybeSingle();

  if (headerError) {
    summary.endpointErrors.push({
      endpoint: `supabase amazon_inbound_shipments ${targetShipmentId}`,
      message: headerError.message,
      details: headerError,
    });
    summary.notFound = [targetShipmentId];
    return { ...summary, shipmentId: targetShipmentId, force: Boolean(params.force) };
  }

  const knownInboundPlanId = str((header as RawRecord | null)?.inbound_plan_id);
  const knownInternalShipmentId = str((header as RawRecord | null)?.amazon_shipment_id);
  if (knownInboundPlanId && knownInternalShipmentId) {
    summary.getShipmentCalls += 1;
    const shipmentDetail = await spApiRequestWithQuotaRetry(
      summary,
      `v2024 getShipment ${knownInboundPlanId}/${knownInternalShipmentId}`,
      () =>
        spApiRequest<unknown>({
          method: "GET",
          path: `/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(
            knownInboundPlanId,
          )}/shipments/${encodeURIComponent(knownInternalShipmentId)}`,
        }),
      { delayMs, retries: 2 },
    );

    if (shipmentDetail) {
      summary.shipmentsFetched += 1;
      const shipmentConfirmationId =
        extractV2024ShipmentConfirmationId(asRecord(shipmentDetail)) ?? targetShipmentId;
      if (shipmentConfirmationId === targetShipmentId) {
        found.add(targetShipmentId);
        await persistV2024Match({
          summary,
          inboundPlanId: knownInboundPlanId,
          shipmentConfirmationId: targetShipmentId,
          internalShipmentId: knownInternalShipmentId,
          rawShipmentRef: null,
          shipmentDetail: asRecord(shipmentDetail),
          fetchTransportationOptions: true,
        });
        summary.notFound = [];
        return { ...summary, shipmentId: targetShipmentId, force: Boolean(params.force) };
      }
    }
  }

  let nextToken: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const pageResult = await spApiRequestWithQuotaRetry(
      summary,
      "v2024 listInboundPlans",
      () => fetchV2024InboundPlansPage(nextToken),
      { delayMs, retries: 2 },
    );
    if (!pageResult) break;

    summary.inboundPlanPagesScanned += 1;
    summary.plansScanned += pageResult.plans.length;
    nextToken = pageResult.nextToken;

    for (const plan of pageResult.plans) {
      const inboundPlanId = str(pick(plan, ["inboundPlanId", "id", "planId"]));
      if (!inboundPlanId) continue;

      summary.getInboundPlanCalls += 1;
      const planDetail = await spApiRequestWithQuotaRetry(
        summary,
        `v2024 getInboundPlan ${inboundPlanId}`,
        () =>
          spApiRequest<unknown>({
            method: "GET",
            path: `/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(
              inboundPlanId,
            )}`,
          }),
        { delayMs, retries: 2 },
      );
      if (!planDetail) {
        if (summary.quotaExceededCount > 0) {
          summary.notFound = found.has(targetShipmentId) ? [] : [targetShipmentId];
          await persistV2024DirectedAttemptStatus(targetShipmentId, summary);
          return { ...summary, shipmentId: targetShipmentId, force: Boolean(params.force) };
        }
        continue;
      }
      summary.plansRead += 1;

      for (const rawShipmentRef of arrayFrom(planDetail, ["shipments"]).map(asRecord)) {
        summary.internalShipmentsChecked += 1;
        const internalShipmentId = extractV2024ShipmentId(rawShipmentRef);
        const directConfirmationId = extractV2024ShipmentConfirmationId(rawShipmentRef);

        if (directConfirmationId === targetShipmentId) {
          found.add(targetShipmentId);
          await persistV2024Match({
            summary,
            inboundPlanId,
            shipmentConfirmationId: targetShipmentId,
            internalShipmentId,
            rawShipmentRef,
            shipmentDetail: null,
            fetchTransportationOptions: true,
          });
          summary.notFound = [];
          return { ...summary, shipmentId: targetShipmentId, force: Boolean(params.force) };
        }

        if (!internalShipmentId) continue;
        summary.getShipmentCalls += 1;
        const shipmentDetail = await spApiRequestWithQuotaRetry(
          summary,
          `v2024 getShipment ${inboundPlanId}/${internalShipmentId}`,
          () =>
            spApiRequest<unknown>({
              method: "GET",
              path: `/inbound/fba/2024-03-20/inboundPlans/${encodeURIComponent(
                inboundPlanId,
              )}/shipments/${encodeURIComponent(internalShipmentId)}`,
            }),
          { delayMs, retries: 2 },
        );
        if (!shipmentDetail) {
          if (summary.quotaExceededCount > 0) {
            summary.notFound = found.has(targetShipmentId) ? [] : [targetShipmentId];
            await persistV2024DirectedAttemptStatus(targetShipmentId, summary);
            return {
              ...summary,
              shipmentId: targetShipmentId,
              force: Boolean(params.force),
            };
          }
          continue;
        }
        summary.shipmentsFetched += 1;

        const resolvedConfirmationId = extractV2024ShipmentConfirmationId(
          asRecord(shipmentDetail),
        );
        if (resolvedConfirmationId !== targetShipmentId) continue;

        found.add(targetShipmentId);
        await persistV2024Match({
          summary,
          inboundPlanId,
          shipmentConfirmationId: targetShipmentId,
          internalShipmentId,
          rawShipmentRef,
          shipmentDetail: asRecord(shipmentDetail),
          fetchTransportationOptions: true,
        });
        summary.notFound = [];
        return { ...summary, shipmentId: targetShipmentId, force: Boolean(params.force) };
      }
    }

    if (!nextToken) break;
  }

  summary.notFound = found.has(targetShipmentId) ? [] : [targetShipmentId];
  await persistV2024DirectedAttemptStatus(targetShipmentId, summary);
  return { ...summary, shipmentId: targetShipmentId, force: Boolean(params.force) };
}

/**
 * Sincroniza envios inbound desde SP-API hacia `amazon_envios`.
 *
 * Si no se pasa `lastUpdatedAfter`, usa por defecto los ultimos 365 dias
 * para no llenar la pantalla con shipments cerrados historicos.
 */
export async function syncInboundShipmentsToAmazonEnvios(params: {
  userId: string | null;
  limit?: number;
  fromDate?: string | null;
  toDate?: string | null;
  year?: number | null;
  includeClosed?: boolean;
  includeClosedCurrentYear?: boolean;
  includeReadyToShip?: boolean;
  allowActiveWithoutDate?: boolean;
}): Promise<SyncInboundShipmentsSummary> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const syncWindow = resolveSyncWindow({
    year: params.year,
    fromDate: params.fromDate,
    toDate: params.toDate,
  });
  const effectiveLastUpdatedAfter = syncWindow.fromDate;
  const effectiveLastUpdatedBefore = syncWindow.toDate;
  const includeClosedCurrentYear = Boolean(params.includeClosedCurrentYear);
  const includeClosed = Boolean(params.includeClosed || includeClosedCurrentYear);
  const includeReadyToShip = params.includeReadyToShip !== false;
  const diagnostic = await buildAmazonInboundShipmentsDiagnostic({
    limit: params.limit,
    lastUpdatedAfter: effectiveLastUpdatedAfter,
    includeClosed,
  });
  const filtered = filterShipmentsForSync(
    diagnostic.shipments,
    effectiveLastUpdatedAfter,
    effectiveLastUpdatedBefore,
    includeClosed,
    includeClosedCurrentYear,
    Boolean(params.allowActiveWithoutDate),
  );
  const shipments = filtered.shipments;
  const shipmentList = shipments.map((entry) => entry.shipment);
  const productMatches = await resolveProductMatches(shipmentList, warnings);
  // SYNC NO DESTRUCTIVO: eliminado cleanupUnlinkedAmazonEnviosIfSafe()
  // Una respuesta parcial NUNCA puede borrar shipments existentes.
  // Los shipments no recibidos en este sync se conservan.
  const cleanup = { deletedUnlinkedRows: 0, skippedByExistingLinks: false };
  const existingLogisticsMeta = await loadExistingAmazonInboundLogisticsMeta(
    shipments
      .map(({ shipment }) => shipment.amazon_shipment_id)
      .filter((id): id is string => Boolean(id)),
  );

  const rows = shipments.flatMap(({ shipment, resolvedDate }) => {
    if (!shipment.amazon_shipment_id) {
      warnings.push("Shipment sin shipment_id omitido.");
      return [];
    }

    return shipment.items.flatMap((item, index) => {
      const row = mapInboundItemToAmazonEnvioRow({
        shipment,
        item,
        userId: params.userId,
        resolvedDate,
        match:
          productMatches.get(itemKey({ shipment, item, index })) ?? {
            productoId: null,
            matchedBy: null,
            ...buildSkuCandidates(resolveItemSku(item)),
          },
      });
      if (!row.sku) {
        warnings.push(`Item sin SKU omitido en shipment ${shipment.amazon_shipment_id}.`);
        return [];
      }
      return [row];
    });
  });
  const headerRows = shipments.flatMap(({ shipment, resolvedDate }) => {
    if (!shipment.amazon_shipment_id) return [];
    return [
      mapInboundShipmentHeaderRow({
        shipment,
        resolvedDate,
        existingLogisticsFlow:
          existingLogisticsMeta.get(shipment.amazon_shipment_id)?.logisticsFlow,
        existingTransportProvider:
          existingLogisticsMeta.get(shipment.amazon_shipment_id)?.transportProvider,
      }),
    ];
  });

  if (rows.length === 0) {
    const v2024Enrichment = await enrichPersistedShipmentsWithV2024(warnings);
    return {
      shipmentsProcessed: shipments.length,
      diagnosticSource: diagnostic.source,
      linesUpserted: 0,
      productsMatched: 0,
      productsUnmatched: 0,
      effectiveLastUpdatedAfter,
      effectiveLastUpdatedBefore,
      syncYear: syncWindow.year,
      includeClosedCurrentYear,
      includeReadyToShip,
      includeClosed,
      skippedByDate: filtered.skippedByDate,
      skippedByStatus: filtered.skippedByStatus,
      skippedByMissingDate: filtered.skippedByMissingDate,
      dateResolvedFromRaw: filtered.dateResolvedFromRaw,
      dateResolvedFromShipmentName: filtered.dateResolvedFromShipmentName,
      activeWithoutDateImported: filtered.activeWithoutDateImported,
      deletedUnlinkedRows: cleanup.deletedUnlinkedRows,
      cleanupSkippedByExistingLinks: cleanup.skippedByExistingLinks,
      v2024RelationsMatched: v2024Enrichment.relationsMatched,
      v2024ShipmentsFetched: v2024Enrichment.shipmentsFetched,
      v2024TransportationOptionsRequests: v2024Enrichment.transportationOptionsRequests,
      v2024TransportationOptionsFetched: v2024Enrichment.transportationOptionsFetched,
      acquisitionComplete: v2024Enrichment.acquisitionComplete,
      warnings,
      errors,
    };
  }

  const { error } = await supabaseAdmin
    .from("amazon_envios")
    .upsert(rows, { onConflict: "shipment_id,sku" });

  if (error) {
    errors.push(error.message);
    throw new Error(error.message);
  }

  if (headerRows.length > 0) {
    const { error: headerError } = await supabaseAdmin
      .from("amazon_inbound_shipments")
      .upsert(headerRows, { onConflict: "shipment_id" });

    if (headerError) {
      errors.push(headerError.message);
      throw new Error(headerError.message);
    }
  }

  const v2024Enrichment = await enrichPersistedShipmentsWithV2024(warnings);

  return {
    diagnosticSource: diagnostic.source,
    shipmentsProcessed: shipments.length,
    linesUpserted: rows.length,
    productsMatched: rows.filter((row) => Boolean(row.producto_id)).length,
    productsUnmatched: rows.filter((row) => !row.producto_id).length,
    effectiveLastUpdatedAfter,
    effectiveLastUpdatedBefore,
    syncYear: syncWindow.year,
    includeClosedCurrentYear,
    includeReadyToShip,
    includeClosed,
    skippedByDate: filtered.skippedByDate,
    skippedByStatus: filtered.skippedByStatus,
    skippedByMissingDate: filtered.skippedByMissingDate,
    dateResolvedFromRaw: filtered.dateResolvedFromRaw,
    dateResolvedFromShipmentName: filtered.dateResolvedFromShipmentName,
    activeWithoutDateImported: filtered.activeWithoutDateImported,
    deletedUnlinkedRows: cleanup.deletedUnlinkedRows,
    cleanupSkippedByExistingLinks: cleanup.skippedByExistingLinks,
    v2024RelationsMatched: v2024Enrichment.relationsMatched,
    v2024ShipmentsFetched: v2024Enrichment.shipmentsFetched,
    v2024TransportationOptionsRequests: v2024Enrichment.transportationOptionsRequests,
    v2024TransportationOptionsFetched: v2024Enrichment.transportationOptionsFetched,
    acquisitionComplete: v2024Enrichment.acquisitionComplete,
    warnings,
    errors,
  };
}

async function cleanupUnlinkedAmazonEnviosIfSafe(): Promise<{
  deletedUnlinkedRows: number;
  skippedByExistingLinks: boolean;
}> {
  const { count: linkedCount, error: linkedError } = await supabaseAdmin
    .from("amazon_envios")
    .select("id", { count: "exact", head: true })
    .not("contenedor_id", "is", null);

  if (linkedError) throw new Error(linkedError.message);

  if ((linkedCount ?? 0) > 0) {
    return { deletedUnlinkedRows: 0, skippedByExistingLinks: true };
  }

  const { count: unlinkedCount, error: countError } = await supabaseAdmin
    .from("amazon_envios")
    .select("id", { count: "exact", head: true })
    .is("contenedor_id", null);

  if (countError) throw new Error(countError.message);

  if ((unlinkedCount ?? 0) === 0) {
    return { deletedUnlinkedRows: 0, skippedByExistingLinks: false };
  }

  const { error: deleteError } = await supabaseAdmin
    .from("amazon_envios")
    .delete()
    .is("contenedor_id", null);

  if (deleteError) throw new Error(deleteError.message);

  return {
    deletedUnlinkedRows: unlinkedCount ?? 0,
    skippedByExistingLinks: false,
  };
}

async function loadExistingAmazonInboundLogisticsMeta(
  shipmentIds: string[],
): Promise<Map<string, { logisticsFlow: string | null; transportProvider: string | null }>> {
  const uniqueIds = Array.from(new Set(shipmentIds.filter(Boolean)));
  const meta = new Map<string, { logisticsFlow: string | null; transportProvider: string | null }>();
  if (uniqueIds.length === 0) return meta;

  const { data, error } = await supabaseAdmin
    .from("amazon_inbound_shipments")
    .select("shipment_id, logistics_flow, transport_provider")
    .in("shipment_id", uniqueIds);

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as RawRecord[]) {
    const shipmentId = str(row.shipment_id);
    if (!shipmentId) continue;
    meta.set(shipmentId, {
      logisticsFlow: str(row.logistics_flow),
      transportProvider: str(row.transport_provider),
    });
  }

  return meta;
}

function firstString(values: Array<unknown>): string | null {
  for (const value of values) {
    const text = str(value);
    if (text) return text;
  }
  return null;
}

function aggregateNumber(rows: RawRecord[], key: string): number {
  return rows.reduce((sum, row) => sum + num(row[key]), 0);
}

function getRawArray(raw: unknown, key: string): string[] {
  const value = asRecord(raw)[key];
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function firstRawShipment(rows: RawRecord[]): RawRecord {
  for (const row of rows) {
    const shipment = asRecord(pick(row.raw, ["shipment"]));
    if (Object.keys(shipment).length > 0) return shipment;
  }
  return {};
}

function buildV0Details(rows: RawRecord[]): AmazonInboundShipmentV0Details {
  const shipment = firstRawShipment(rows);
  const shipFromAddress = asRecord(pick(shipment, ["ShipFromAddress", "shipFromAddress"]));

  return {
    ship_from_name: str(pick(shipFromAddress, ["Name", "name"])),
    ship_from_city: str(pick(shipFromAddress, ["City", "city"])),
    ship_from_district_or_county: str(
      pick(shipFromAddress, ["DistrictOrCounty", "districtOrCounty"]),
    ),
    ship_from_state_or_province_code: str(
      pick(shipFromAddress, ["StateOrProvinceCode", "stateOrProvinceCode"]),
    ),
    ship_from_country_code: str(pick(shipFromAddress, ["CountryCode", "countryCode"])),
    destination_fulfillment_center_id: str(
      pick(shipment, ["DestinationFulfillmentCenterId", "destinationFulfillmentCenterId"]),
    ),
    shipment_status: str(pick(shipment, ["ShipmentStatus", "shipmentStatus", "status"])),
    label_prep_type: str(pick(shipment, ["LabelPrepType", "labelPrepType"])),
    box_contents_source: str(pick(shipment, ["BoxContentsSource", "boxContentsSource"])),
  };
}

async function loadProductSummaries(
  productIds: string[],
): Promise<Map<string, AmazonInboundProductSummary>> {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const { data, error } = await supabaseAdmin
    .from("productos")
    .select("id, sku, nombre, producto_detalle(imagen_url)")
    .in("id", uniqueIds);

  if (error) throw new Error(error.message);

  const products = new Map<string, AmazonInboundProductSummary>();
  for (const row of (data ?? []) as RawRecord[]) {
    const id = str(row.id);
    if (!id) continue;

    const rawDetails = row.producto_detalle;
    const details = Array.isArray(rawDetails)
      ? rawDetails
      : rawDetails
        ? [rawDetails]
        : [];
    const imagenUrl =
      details
        .map(asRecord)
        .map((detail) => str(detail.imagen_url))
        .find(Boolean) ?? null;

    products.set(id, {
      id,
      sku: str(row.sku),
      nombre: str(row.nombre),
      imagen_url: imagenUrl,
    });
  }

  return products;
}

async function loadLinkedContainerSummaries(
  containerIds: string[],
): Promise<Map<string, LinkedContainerSummary>> {
  const uniqueIds = Array.from(new Set(containerIds.filter(Boolean)));
  const containers = new Map<string, LinkedContainerSummary>();
  if (uniqueIds.length === 0) return containers;

  const { data, error } = await supabaseAdmin
    .from("contenedores")
    .select("id, identificador_embarque, fecha_eta_estimada, fecha_salida")
    .in("id", uniqueIds);

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as RawRecord[]) {
    const id = str(row.id);
    if (!id) continue;
    containers.set(id, {
      id,
      identificador_embarque: str(row.identificador_embarque),
      fecha_eta_estimada: str(row.fecha_eta_estimada),
      fecha_salida: str(row.fecha_salida),
    });
  }

  return containers;
}

/**
 * Lista `amazon_envios` agrupado por `shipment_id`.
 *
 * mode=operative (por defecto): scope operativo:
 *   - año actual: TODOS los shipments
 *   - año anterior: no terminales O review_required
 *   - anteriores: solo review_required
 *
 * mode=history: histórico explícito — requiere year válido (400 si inválido).
 *   Devuelve todos los shipments del año indicado (incluyendo terminales).
 *   Solo lectura Supabase, sin llamadas Amazon.
 */
export async function listAmazonInboundShipmentsFromAmazonEnvios(params: {
  mode?: "operative" | "history";
  includeClosed?: boolean;
  year?: number | null;
  includeClosedCurrentYear?: boolean;
} = {}): Promise<AmazonInboundShipmentListResult> {
  const mode = params.mode ?? "operative";

  // mode=history requiere año válido — NO fallback silencioso
  if (mode === "history") {
    const historyYear = normalizeYear(params.year);
    if (!historyYear) {
      throw new Error(
        `INVALID_YEAR: mode=history requiere year válido (2020-2100). Recibido: ${String(params.year)}`,
      );
    }
    return listHistoryScope(historyYear);
  }

  return listOperativeScope(params);
}

// ─── Helpers compartidos para list ───────────────────────────────────────────

const LIST_SELECT = `id, shipment_id, shipment_name, reference_id, inbound_plan_id, sku,
  producto_id, cantidad_enviada, cantidad_recibida, cantidad_esperada,
  cantidad_localizada, destination_country, destination_center, fecha_creacion,
  fecha_cerrado, estado, transport_status, contenedor_id, link_status,
  link_confidence, matched_by, raw, imported_at`;

async function fetchAmazonEnviosRows(limit = 3000): Promise<RawRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("amazon_envios")
    .select(LIST_SELECT)
    .order("fecha_creacion", { ascending: false, nullsFirst: false })
    .order("imported_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data ?? []) as RawRecord[];
}

function resolveShipmentYear(row: AmazonInboundShipmentListGroup): number | null {
  const ts = resolvedShipmentTimestamp(row);
  if (!ts) return null;
  const parsed = new Date(ts);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear();
}

function buildShipmentGroups(
  rows: RawRecord[],
  productSummaries: Map<string, AmazonInboundProductSummary>,
  linkedContainerSummaries: Map<string, LinkedContainerSummary>,
  orderLinksByShipment: Map<string, ShipmentOrderLinkSummary[]>,
  shipmentExtras: Awaited<ReturnType<typeof loadAmazonInboundShipmentExtras>>,
): AmazonInboundShipmentListGroup[] {
  const groups = new Map<string, RawRecord[]>();
  for (const row of rows) {
    const shipmentId = str(row.shipment_id);
    if (!shipmentId) continue;
    const current = groups.get(shipmentId) ?? [];
    current.push(row);
    groups.set(shipmentId, current);
  }

  return Array.from(groups.entries())
    .map(([shipmentId, shipmentRows]) => {
      const linkedContainerIds = Array.from(
        new Set(shipmentRows.map((row) => str(row.contenedor_id)).filter(Boolean)),
      );
      const linkStatuses = Array.from(
        new Set(shipmentRows.map((row) => str(row.link_status)).filter(Boolean)),
      );
      const confidences = shipmentRows
        .map((row) => num(row.link_confidence))
        .filter((n) => n > 0);
      const singleContainerId =
        linkedContainerIds.length === 1 ? linkedContainerIds[0] ?? null : null;
      const header = shipmentExtras.headers.get(shipmentId) ?? null;
      const logisticsFlow = header?.logistics_flow ?? null;
      const transportProvider = header?.transport_provider ?? null;
      const estado = firstString(shipmentRows.map((row) => row.estado));

      const totalShipped = aggregateNumber(shipmentRows, "cantidad_enviada");
      const totalReceived = aggregateNumber(shipmentRows, "cantidad_recibida");
      const totalDiscrepancy = Math.max(0, totalShipped - totalReceived);

      // review_required: cualquier item con review_required=true, o estado desconocido/MIXED/CLOSED+discrepancia
      const anyItemReview = shipmentRows.some(
        (row) => asRecord(row.raw).review_required === true,
      );
      const shipmentReviewRequired =
        anyItemReview || computeReviewRequired(estado, totalDiscrepancy);

      // Fechas Amazon separadas desde raw
      const amazonCreatedAt =
        firstString(shipmentRows.map((row) => pick(row.raw, ["amazon_created_at"]))) ??
        firstString(shipmentRows.map((row) => pick(row.raw, ["created_at_amazon"])));
      const amazonLastUpdatedAt =
        firstString(shipmentRows.map((row) => pick(row.raw, ["amazon_last_updated_at"]))) ??
        firstString(shipmentRows.map((row) => pick(row.raw, ["updated_at_amazon"])));

      const resolvedShipmentDate = firstString(
        shipmentRows.map((row) => pick(row.raw, ["resolved_shipment_date"])),
      );

      const importedAt =
        shipmentRows
          .map((row) => timestamp(row.imported_at))
          .filter((v): v is string => Boolean(v))
          .sort()
          .at(-1) ?? null;

      const group: AmazonInboundShipmentListGroup = {
        shipment_id: shipmentId,
        shipment_name: firstString(shipmentRows.map((row) => row.shipment_name)),
        reference_id: firstString(shipmentRows.map((row) => row.reference_id)),
        inbound_plan_id:
          shipmentExtras.headers.get(shipmentId)?.inbound_plan_id ??
          firstString(shipmentRows.map((row) => row.inbound_plan_id)),
        logistics_flow: logisticsFlow,
        transport_provider: transportProvider,
        estado,
        transport_status: firstString(shipmentRows.map((row) => row.transport_status)),
        destination_country: firstString(shipmentRows.map((row) => row.destination_country)),
        destination_center: firstString(shipmentRows.map((row) => row.destination_center)),
        fecha_creacion: firstString(shipmentRows.map((row) => row.fecha_creacion)),
        fecha_cerrado: firstString(shipmentRows.map((row) => row.fecha_cerrado)),
        date_source: firstString(shipmentRows.map((row) => pick(row.raw, ["date_source"]))),
        resolved_shipment_date: resolvedShipmentDate,
        amazon_created_at: amazonCreatedAt,
        amazon_last_updated_at: amazonLastUpdatedAt,
        shipment_year: null, // se rellena después
        imported_at: importedAt,
        total_skus: shipmentRows.length,
        total_cantidad_enviada: totalShipped,
        total_cantidad_recibida: totalReceived,
        total_cantidad_esperada: aggregateNumber(shipmentRows, "cantidad_esperada"),
        total_cantidad_localizada: aggregateNumber(shipmentRows, "cantidad_localizada"),
        total_discrepancy_quantity: totalDiscrepancy,
        productsMatched: shipmentRows.filter((row) => Boolean(row.producto_id)).length,
        productsUnmatched: shipmentRows.filter((row) => !row.producto_id).length,
        contenedor_id:
          singleContainerId ?? (linkedContainerIds.length > 1 ? "MULTIPLE" : null),
        link_status:
          linkStatuses.length === 1
            ? linkStatuses[0] ?? null
            : linkStatuses.length > 1
              ? "MIXED"
              : null,
        link_confidence: confidences.length > 0 ? Math.max(...confidences) : null,
        review_required: shipmentReviewRequired,
        visible_logistics: resolveAmazonShipmentVisibleLogistics({
          header,
          logisticsFlow,
          container: singleContainerId
            ? linkedContainerSummaries.get(singleContainerId) ?? null
            : null,
        }),
        header,
        documents_count: shipmentExtras.documentCounts.get(shipmentId) ?? 0,
        costs_count: shipmentExtras.costCounts.get(shipmentId) ?? 0,
        costs_total: shipmentExtras.costTotals.get(shipmentId) ?? 0,
        amazon_v0: buildV0Details(shipmentRows),
        linked_orders: orderLinksByShipment.get(shipmentId) ?? [],
        items: shipmentRows.map((row) => {
          const productoId = str(row.producto_id);
          return {
            id: str(row.id),
            sku: str(row.sku),
            seller_sku_original: str(pick(row.raw, ["seller_sku_original"])),
            sku_limpio: str(pick(row.raw, ["sku_limpio"])),
            match_candidates: getRawArray(row.raw, "match_candidates"),
            matched_by: str(row.matched_by) ?? str(pick(row.raw, ["matched_by"])),
            date_source: str(pick(row.raw, ["date_source"])),
            resolved_shipment_date: str(pick(row.raw, ["resolved_shipment_date"])),
            producto_id: productoId,
            producto: productoId ? productSummaries.get(productoId) ?? null : null,
            cantidad_enviada: num(row.cantidad_enviada),
            cantidad_recibida: num(row.cantidad_recibida),
            cantidad_esperada: num(row.cantidad_esperada),
            cantidad_localizada: num(row.cantidad_localizada),
            link_status: str(row.link_status),
            link_confidence: row.link_confidence == null ? null : num(row.link_confidence),
            raw: row.raw ?? null,
          };
        }),
      };

      // Calcular shipment_year a partir de la fecha de creación real
      group.shipment_year = resolveShipmentYear(group);
      return group;
    })
    .sort((a, b) => {
      const activeDiff = Number(isClosedStatus(a.estado)) - Number(isClosedStatus(b.estado));
      if (activeDiff !== 0) return activeDiff;
      const aTime = new Date(a.fecha_creacion ?? a.imported_at ?? 0).getTime();
      const bTime = new Date(b.fecha_creacion ?? b.imported_at ?? 0).getTime();
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    });
}

// ─── Scope OPERATIVO ─────────────────────────────────────────────────────────

async function listOperativeScope(params: {
  includeClosed?: boolean;
  includeClosedCurrentYear?: boolean;
}): Promise<AmazonInboundShipmentListResult> {
  const rows = await fetchAmazonEnviosRows(3000);
  const productSummaries = await loadProductSummaries(
    rows.map((row) => str(row.producto_id)).filter((id): id is string => Boolean(id)),
  );
  const linkedContainerSummaries = await loadLinkedContainerSummaries(
    rows.map((row) => str(row.contenedor_id)).filter((id): id is string => Boolean(id)),
  );
  const uniqueShipmentIds = Array.from(
    new Set(
      rows.map((row) => str(row.shipment_id)).filter((id): id is string => Boolean(id)),
    ),
  );
  const orderLinksByShipment = await listLinkedOrdersForShipments(uniqueShipmentIds);
  const shipmentExtras = await loadAmazonInboundShipmentExtras(uniqueShipmentIds);

  const allShipments = buildShipmentGroups(
    rows,
    productSummaries,
    linkedContainerSummaries,
    orderLinksByShipment,
    shipmentExtras,
  );

  const currentYear = currentUtcYear();
  const prevYear = currentYear - 1;
  const includeClosedCurrentYear = params.includeClosedCurrentYear ?? params.includeClosed ?? true;

  // Scope operativo:
  // - año actual: TODOS (incluyendo terminales si includeClosedCurrentYear)
  // - año anterior: no terminales O review_required
  // - anteriores: solo review_required demostrado
  const visibleShipments = allShipments.filter((shipment) => {
    const year = shipment.shipment_year;
    const terminal = isTerminalStatus(shipment.estado);
    const isClosed = isCurrentYearAllowedTerminalStatus(shipment.estado);

    if (year === currentYear) {
      if (!terminal) return true;
      if (isClosed && includeClosedCurrentYear) return true;
      return false;
    }

    if (year === prevYear) {
      if (!terminal) return true;
      if (shipment.review_required) return true;
      return false;
    }

    // Años anteriores: solo review_required
    return shipment.review_required === true;
  });

  const closedCount = allShipments.filter(
    (s) => s.shipment_year === currentYear && isCurrentYearAllowedTerminalStatus(s.estado),
  ).length;
  const hiddenClosedCount = !includeClosedCurrentYear ? closedCount : 0;

  return {
    shipments: visibleShipments,
    closedCount,
    hiddenClosedCount,
    mode: "operative",
    totalCount: allShipments.length,
  };
}

// ─── Scope HISTÓRICO ─────────────────────────────────────────────────────────

async function listHistoryScope(year: number): Promise<AmazonInboundShipmentListResult> {
  const rows = await fetchAmazonEnviosRows(5000);
  const productSummaries = await loadProductSummaries(
    rows.map((row) => str(row.producto_id)).filter((id): id is string => Boolean(id)),
  );
  const linkedContainerSummaries = await loadLinkedContainerSummaries(
    rows.map((row) => str(row.contenedor_id)).filter((id): id is string => Boolean(id)),
  );
  const uniqueShipmentIds = Array.from(
    new Set(
      rows.map((row) => str(row.shipment_id)).filter((id): id is string => Boolean(id)),
    ),
  );
  const orderLinksByShipment = await listLinkedOrdersForShipments(uniqueShipmentIds);
  const shipmentExtras = await loadAmazonInboundShipmentExtras(uniqueShipmentIds);

  const allShipments = buildShipmentGroups(
    rows,
    productSummaries,
    linkedContainerSummaries,
    orderLinksByShipment,
    shipmentExtras,
  );

  // Histórico: devuelve TODOS los shipments del año indicado (incluye terminales)
  const yearShipments = allShipments.filter(
    (shipment) => shipment.shipment_year === year,
  );

  const closedCount = yearShipments.filter((s) =>
    isCurrentYearAllowedTerminalStatus(s.estado),
  ).length;

  return {
    shipments: yearShipments,
    closedCount,
    hiddenClosedCount: 0,
    mode: "history",
    historyYear: year,
    totalCount: yearShipments.length,
  };
}
