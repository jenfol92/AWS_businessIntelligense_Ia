import { createHash, randomUUID } from "node:crypto";

import type { ProductMatch } from "./skuProductMatching";

/** Persisted legacy labels: EU means PAN_EU and UK means the GB pool. */
export type OperationalPool = "EU" | "UK";

export type InventorySummaryObservation = {
  marketplaceId: string;
  sellerSku?: string;
  fnSku?: string;
  asin?: string;
  condition?: string;
  lastUpdatedTime?: string;
  totalQuantity?: number;
  inventoryDetails?: {
    fulfillableQuantity?: number;
    reservedQuantity?: {
      totalReservedQuantity?: number;
      pendingCustomerOrderQuantity?: number;
      pendingTransshipmentQuantity?: number;
      fcProcessingQuantity?: number;
    };
    inboundWorkingQuantity?: number;
    inboundShippedQuantity?: number;
    inboundReceivingQuantity?: number;
    unfulfillableQuantity?: { totalUnfulfillableQuantity?: number };
    researchingQuantity?: { totalResearchingQuantity?: number };
  };
};

export type CanonicalInventorySnapshotRow = {
  snapshot_run_id: string;
  snapshot_at: string;
  observed_at: string;
  marketplace_id: string;
  country: null;
  seller_sku_original: string;
  sku_original: string;
  sku_limpio: string;
  producto_id: string | null;
  asin: string;
  fnsku: string;
  condition: string | null;
  operational_pool: OperationalPool;
  seller_sku_aliases: string[];
  observed_marketplaces: string[];
  fulfillable_quantity: number;
  reserved_quantity: number;
  pending_customer_order_quantity: number;
  pending_transshipment_quantity: number;
  fc_processing_quantity: number;
  inbound_working_quantity: number;
  inbound_shipped_quantity: number;
  inbound_receiving_quantity: number;
  inbound_total_quantity: number;
  inbound_quantity: number;
  unfulfillable_quantity: number;
  researching_quantity: number;
  total_quantity_raw: number;
  amazon_last_updated_time: string | null;
  source: "spapi_fba_inventory_summaries";
  confidence: "TRUSTED";
  conflict_metadata: null;
  row_fingerprint: string;
  raw: Record<string, unknown>;
  imported_at: string;
};

export type IncompleteInventoryObservation = {
  marketplaceId: string;
  sellerSku: string;
  status: "IDENTITY_INCOMPLETE" | "IDENTITY_AMBIGUOUS" | "ASIN_IDENTITY_CONFLICT";
  reason: "MISSING_ASIN" | "MISSING_FNSKU" | "PRODUCT_NOT_RESOLVED";
  raw: InventorySummaryObservation;
};

export class InventorySnapshotValidationError extends Error {
  readonly code: "INCOMPLETE_IDENTITY" | "FNSKU_CONFLICT" | "PRODUCT_ID_CONFLICT" | "UNSUPPORTED_MARKETPLACE";

  constructor(
    code:
      | "INCOMPLETE_IDENTITY"
      | "FNSKU_CONFLICT"
      | "PRODUCT_ID_CONFLICT"
      | "UNSUPPORTED_MARKETPLACE",
    message: string,
  ) {
    super(message);
    this.name = "InventorySnapshotValidationError";
    this.code = code;
  }
}

const EU_MARKETPLACES = new Set([
  "A1RKKUPIHCS9HS", // ES
  "A13V1IB3VIYZZH", // FR
  "A1PA6795UKMFR9", // DE
  "APJ6JRA9NG5V4", // IT
  "A1C3SOZRARQ6R3", // PL
  "A2NODRKZP88ZB9", // SE
  "ES", "FR", "DE", "IT", "PL", "SE",
]);
const UK_MARKETPLACES = new Set(["A1F83G8C2ARO7P", "GB", "UK"]);
const inventoryIdentityKey = (sellerSku: string, asin: string | null | undefined) => `${sellerSku.trim()}\u0000${String(asin ?? "").trim().toUpperCase()}`;

export function operationalPoolForMarketplace(marketplaceId: string): OperationalPool {
  if (EU_MARKETPLACES.has(marketplaceId)) return "EU";
  if (UK_MARKETPLACES.has(marketplaceId)) return "UK";
  throw new InventorySnapshotValidationError(
    "UNSUPPORTED_MARKETPLACE",
    `Marketplace sin pool operativo configurado: ${marketplaceId}`,
  );
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function quantities(row: InventorySummaryObservation): Record<string, number> {
  const details = row.inventoryDetails ?? {};
  const reserved = details.reservedQuantity ?? {};
  return {
    fulfillableQuantity: number(details.fulfillableQuantity),
    totalReservedQuantity: number(reserved.totalReservedQuantity),
    pendingCustomerOrderQuantity: number(reserved.pendingCustomerOrderQuantity),
    pendingTransshipmentQuantity: number(reserved.pendingTransshipmentQuantity),
    fcProcessingQuantity: number(reserved.fcProcessingQuantity),
    inboundWorkingQuantity: number(details.inboundWorkingQuantity),
    inboundShippedQuantity: number(details.inboundShippedQuantity),
    inboundReceivingQuantity: number(details.inboundReceivingQuantity),
    totalUnfulfillableQuantity: number(details.unfulfillableQuantity?.totalUnfulfillableQuantity),
    totalResearchingQuantity: number(details.researchingQuantity?.totalResearchingQuantity),
    totalQuantity: number(row.totalQuantity),
  };
}

function extendedSignature(row: InventorySummaryObservation): string {
  return JSON.stringify({ quantities: quantities(row), condition: row.condition ?? null });
}

function fingerprint(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function buildCanonicalInventorySnapshot(params: {
  observations: readonly InventorySummaryObservation[];
  productMatches: ReadonlyMap<string, ProductMatch>;
  observedAt?: string;
  snapshotRunId?: string;
}): { snapshotRunId: string; observedAt: string; rows: CanonicalInventorySnapshotRow[]; incompleteObservations: IncompleteInventoryObservation[]; warnings: string[] } {
  const snapshotRunId = params.snapshotRunId ?? randomUUID();
  const observedAt = params.observedAt ?? new Date().toISOString();
  const grouped = new Map<string, InventorySummaryObservation[]>();
  const incompleteObservations: IncompleteInventoryObservation[] = [];
  const warnings: string[] = [];

  for (const observation of params.observations) {
    const asin = String(observation.asin ?? "").trim();
    const fnsku = String(observation.fnSku ?? "").trim();
    const sellerSku = String(observation.sellerSku ?? "").trim();
    if (!sellerSku) {
      throw new InventorySnapshotValidationError(
        "INCOMPLETE_IDENTITY",
        "Inventory Summary sin Seller SKU; no se puede conservar trazabilidad de la respuesta.",
      );
    }
    if (!asin || !fnsku) {
      const reason = !asin ? "MISSING_ASIN" : "MISSING_FNSKU";
      incompleteObservations.push({ marketplaceId: observation.marketplaceId, sellerSku, status: "IDENTITY_INCOMPLETE", reason, raw: observation });
      warnings.push(`IDENTITY_INCOMPLETE:${reason}:${sellerSku}`);
      continue;
    }
    const pool = operationalPoolForMarketplace(observation.marketplaceId);
    const match = params.productMatches.get(inventoryIdentityKey(sellerSku, asin)) ?? params.productMatches.get(sellerSku);
    if (match?.resolutionStatus === "ASIN_IDENTITY_CONFLICT") {
      incompleteObservations.push({ marketplaceId: observation.marketplaceId, sellerSku, status: "ASIN_IDENTITY_CONFLICT", reason: "PRODUCT_NOT_RESOLVED", raw: observation });
      warnings.push(`ASIN_IDENTITY_CONFLICT:${sellerSku}:${match.expectedAsin}:${asin}`);
      continue;
    }
    if (!match?.productoId) {
      const status = match?.resolutionStatus === "IDENTITY_AMBIGUOUS" ? "IDENTITY_AMBIGUOUS" : "IDENTITY_INCOMPLETE";
      incompleteObservations.push({ marketplaceId: observation.marketplaceId, sellerSku, status, reason: "PRODUCT_NOT_RESOLVED", raw: observation });
      warnings.push(`${status}:PRODUCT_NOT_RESOLVED:${sellerSku}`);
      continue;
    }
    const key = `${pool}\u0000${match.productoId}\u0000${asin}\u0000${fnsku}`;
    const rows = grouped.get(key) ?? [];
    rows.push(observation);
    grouped.set(key, rows);
  }

  const canonicalRows: CanonicalInventorySnapshotRow[] = [];
  for (const [key, observations] of Array.from(grouped.entries())) {
    const [pool, productoId, asin, fnsku] = key.split("\u0000") as [OperationalPool, string, string, string];
    if (!observations.every((row) => extendedSignature(row) === extendedSignature(observations[0]))) {
      throw new InventorySnapshotValidationError(
        "FNSKU_CONFLICT",
        `Firmas incompatibles para ${pool}/${productoId}/${asin}/${fnsku}.`,
      );
    }
    const row = observations[0];
    const sellerSkus = Array.from(new Set(observations.map((item) => String(item.sellerSku ?? "").trim()))).sort();
    const sellerSku = sellerSkus[0];
    const marketplaceIds = Array.from(new Set(observations.map((item) => item.marketplaceId))).sort();
    const marketplaceId = marketplaceIds[0];
    const match = params.productMatches.get(inventoryIdentityKey(sellerSku, asin)) ?? params.productMatches.get(sellerSku);
    const q = quantities(row);
    const inboundTotal = q.inboundWorkingQuantity + q.inboundShippedQuantity + q.inboundReceivingQuantity;
    canonicalRows.push({
      snapshot_run_id: snapshotRunId,
      snapshot_at: observedAt,
      observed_at: observedAt,
      marketplace_id: marketplaceId,
      country: null,
      seller_sku_original: sellerSku,
      sku_original: sellerSku,
      sku_limpio: match?.skuLimpio ?? sellerSku,
      producto_id: productoId,
      asin,
      fnsku,
      condition: row.condition ?? null,
      operational_pool: pool,
      seller_sku_aliases: sellerSkus,
      observed_marketplaces: marketplaceIds,
      fulfillable_quantity: q.fulfillableQuantity,
      reserved_quantity: q.totalReservedQuantity,
      pending_customer_order_quantity: q.pendingCustomerOrderQuantity,
      pending_transshipment_quantity: q.pendingTransshipmentQuantity,
      fc_processing_quantity: q.fcProcessingQuantity,
      inbound_working_quantity: q.inboundWorkingQuantity,
      inbound_shipped_quantity: q.inboundShippedQuantity,
      inbound_receiving_quantity: q.inboundReceivingQuantity,
      inbound_total_quantity: inboundTotal,
      inbound_quantity: inboundTotal,
      unfulfillable_quantity: q.totalUnfulfillableQuantity,
      researching_quantity: q.totalResearchingQuantity,
      total_quantity_raw: q.totalQuantity,
      amazon_last_updated_time: String(row.lastUpdatedTime ?? "").trim() || null,
      source: "spapi_fba_inventory_summaries",
      confidence: "TRUSTED",
      conflict_metadata: null,
      row_fingerprint: fingerprint([snapshotRunId, sellerSku, marketplaceId, asin, fnsku]),
      raw: {
        ...(JSON.parse(JSON.stringify(row)) as Record<string, unknown>),
        identity: {
          resolutionStatus: match?.resolutionStatus ?? null,
          aliasStatus: match?.aliasStatus ?? null,
          resolutionSource: match?.matchedBy ?? null,
          sellerSkus,
        },
      },
      imported_at: observedAt,
    });
  }

  return { snapshotRunId, observedAt, rows: canonicalRows, incompleteObservations, warnings };
}
