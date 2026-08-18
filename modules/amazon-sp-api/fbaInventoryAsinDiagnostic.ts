export type AmazonInventoryIdentityEvidence = {
  asin: string;
  sellerSku: string;
  fnSku: string | null;
  marketplace: string | null;
  source: string;
  lastObservedQuantity: number | null;
  lastObservedDate: string | null;
};

export type AmazonInventoryIdentityRelationship =
  | "DISTINCT_INVENTORY"
  | "DUPLICATE_REPRESENTATION"
  | "SAME_FNSKU_UNKNOWN"
  | "UNKNOWN";

export type AmazonInventoryIdentityPair = {
  left: AmazonInventoryIdentityEvidence;
  right: AmazonInventoryIdentityEvidence;
  relationship: AmazonInventoryIdentityRelationship;
  duplicateEvidence: string[];
};

// Read-only evidence transcribed from the persisted BY_COUNTRY/report audit.
// `marketplace` is deliberately null: that report identifies physical country,
// not the marketplace dimension returned by getInventorySummaries.
export const ALAIA_PERSISTED_INVENTORY_EVIDENCE: AmazonInventoryIdentityEvidence[] = [
  {
    asin: "B0DJBQGKBT",
    sellerSku: "f8436616610104",
    fnSku: "X00259GEWP",
    marketplace: null,
    source: "GET_AFN_INVENTORY_DATA_BY_COUNTRY:GB",
    lastObservedQuantity: 153,
    lastObservedDate: "2026-07-21",
  },
  {
    asin: "B0DJBQGKBT",
    sellerSku: "f8436616610104",
    fnSku: "X00259GEWP",
    marketplace: null,
    source: "GET_AFN_INVENTORY_DATA_BY_COUNTRY:DE",
    lastObservedQuantity: 287,
    lastObservedDate: "2026-07-21",
  },
  {
    asin: "B0DJBQGKBT",
    sellerSku: "f8436616610104UK",
    fnSku: "B0DJBQGKBT",
    marketplace: null,
    source: "GET_AFN_INVENTORY_DATA_BY_COUNTRY:GB",
    lastObservedQuantity: 213,
    lastObservedDate: "2026-07-21",
  },
  {
    asin: "B0DJBQGKBT",
    sellerSku: "Amazon.Found.B0DJBQGKBT",
    fnSku: "B0DJBQGKBT",
    marketplace: null,
    source: "GET_AFN_INVENTORY_DATA_BY_COUNTRY:GB",
    lastObservedQuantity: 213,
    lastObservedDate: "2026-07-21",
  },
];

export function resolveAmazonInventoryIdentitiesForAsin(
  asin: string,
  evidence: readonly AmazonInventoryIdentityEvidence[] = ALAIA_PERSISTED_INVENTORY_EVIDENCE,
): AmazonInventoryIdentityEvidence[] {
  const normalizedAsin = asin.trim().toUpperCase();
  return evidence
    .filter((row) => row.asin.trim().toUpperCase() === normalizedAsin)
    .map((row) => ({ ...row }))
    .sort((a, b) =>
      a.sellerSku.localeCompare(b.sellerSku) ||
      (a.fnSku ?? "").localeCompare(b.fnSku ?? "") ||
      a.source.localeCompare(b.source),
    );
}

function sameObservation(left: AmazonInventoryIdentityEvidence, right: AmazonInventoryIdentityEvidence) {
  return left.lastObservedQuantity != null &&
    left.lastObservedQuantity === right.lastObservedQuantity &&
    left.lastObservedDate != null &&
    left.lastObservedDate === right.lastObservedDate;
}

export function classifyAmazonInventoryIdentityPair(
  left: AmazonInventoryIdentityEvidence,
  right: AmazonInventoryIdentityEvidence,
): AmazonInventoryIdentityPair {
  const duplicateEvidence: string[] = [];
  if (left.asin === right.asin) duplicateEvidence.push("SAME_ASIN");
  if (left.fnSku && left.fnSku === right.fnSku) duplicateEvidence.push("SAME_FNSKU");
  if (left.lastObservedQuantity != null && left.lastObservedQuantity === right.lastObservedQuantity) {
    duplicateEvidence.push("SAME_QUANTITY");
  }
  if (left.lastObservedDate && left.lastObservedDate === right.lastObservedDate) {
    duplicateEvidence.push("SAME_OBSERVED_DATE");
  }

  // Equality is evidence, never proof. A separate physical-pool/label-owner
  // provenance signal is required before DUPLICATE_REPRESENTATION or
  // DISTINCT_INVENTORY can be asserted.
  const relationship: AmazonInventoryIdentityRelationship =
    left.asin === right.asin && left.fnSku && left.fnSku === right.fnSku
      ? "SAME_FNSKU_UNKNOWN"
      : "UNKNOWN";

  if (sameObservation(left, right)) duplicateEvidence.push("MATCHING_SNAPSHOT");
  return { left, right, relationship, duplicateEvidence };
}

export function buildAmazonInventoryIdentityPairs(
  identities: readonly AmazonInventoryIdentityEvidence[],
): AmazonInventoryIdentityPair[] {
  const pairs: AmazonInventoryIdentityPair[] = [];
  for (let left = 0; left < identities.length; left += 1) {
    for (let right = left + 1; right < identities.length; right += 1) {
      pairs.push(classifyAmazonInventoryIdentityPair(identities[left], identities[right]));
    }
  }
  return pairs;
}

export function sellerSkusForAsinRequest(identities: readonly AmazonInventoryIdentityEvidence[]) {
  return Array.from(new Set(identities.map((row) => row.sellerSku).filter(Boolean))).sort();
}

export type ReturnedInventoryRow = {
  marketplace: string;
  asin: string | null;
  sellerSku: string | null;
  fnSku: string | null;
  quantities: Record<string, number | null>;
  lastUpdatedTime?: string | null;
};

export type ReconciledInventoryRow = ReturnedInventoryRow & {
  inventoryClassification:
    | "UNIQUE_FNSKU"
    | "DUPLICATE_REPRESENTATION"
    | "FNSKU_CONFLICT"
    | "UNKNOWN";
};

export type CanonicalAsinInventory = {
  asin: string;
  availableFba: number;
  reservedFba: number;
  inbound: { working: number; shipped: number; receiving: number; total: number };
  unfulfillableFba: number;
  researchingFba: number;
  uniqueFnskuCount: number;
  sellerSkuRepresentationCount: number;
  inventoryConfidence: "TRUSTED" | "FNSKU_CONFLICT" | "INCOMPLETE";
  conflictingFnskus: string[];
  incompleteFnskus: string[];
  rawIdentities: ReconciledInventoryRow[];
};

const OPERATIONAL_QUANTITY_FIELDS = [
  "fulfillableQuantity",
  "totalReservedQuantity",
  "inboundWorkingQuantity",
  "inboundShippedQuantity",
  "inboundReceivingQuantity",
  "totalUnfulfillableQuantity",
  "totalResearchingQuantity",
  "totalQuantity",
] as const;

type OperationalQuantityField = typeof OPERATIONAL_QUANTITY_FIELDS[number];

function hasCompleteOperationalSignature(row: ReturnedInventoryRow): boolean {
  return OPERATIONAL_QUANTITY_FIELDS.every((field) => typeof row.quantities[field] === "number") &&
    typeof row.lastUpdatedTime === "string" && row.lastUpdatedTime.length > 0;
}

function sameOperationalSignature(left: ReturnedInventoryRow, right: ReturnedInventoryRow): boolean {
  return hasCompleteOperationalSignature(left) &&
    hasCompleteOperationalSignature(right) &&
    left.lastUpdatedTime === right.lastUpdatedTime &&
    OPERATIONAL_QUANTITY_FIELDS.every((field) => left.quantities[field] === right.quantities[field]);
}

function quantity(row: ReturnedInventoryRow, field: OperationalQuantityField): number {
  return row.quantities[field] as number;
}

export function reconcileReturnedRowsForAsin(
  asin: string,
  rows: readonly ReturnedInventoryRow[],
): CanonicalAsinInventory & { rows: ReconciledInventoryRow[]; asinTotal: number | "UNKNOWN" } {
  const matching = rows.filter((row) => row.asin === asin);
  const byFnsku = new Map<string, ReturnedInventoryRow[]>();
  for (const row of matching) {
    if (!row.fnSku) continue;
    const group = byFnsku.get(row.fnSku) ?? [];
    group.push(row);
    byFnsku.set(row.fnSku, group);
  }

  const groupClassification = new Map<string, ReconciledInventoryRow["inventoryClassification"]>();
  const trustedContributions: ReturnedInventoryRow[] = [];
  const conflictingFnskus: string[] = [];
  const incompleteFnskus: string[] = [];

  byFnsku.forEach((group, fnSku) => {
    if (!group.every(hasCompleteOperationalSignature)) {
      groupClassification.set(fnSku, "UNKNOWN");
      incompleteFnskus.push(fnSku);
      return;
    }
    if (!group.every((row) => sameOperationalSignature(group[0], row))) {
      groupClassification.set(fnSku, "FNSKU_CONFLICT");
      conflictingFnskus.push(fnSku);
      return;
    }
    groupClassification.set(fnSku, group.length > 1 ? "DUPLICATE_REPRESENTATION" : "UNIQUE_FNSKU");
    trustedContributions.push(group[0]);
  });

  const reconciled = matching.map((row): ReconciledInventoryRow => ({
    ...row,
    quantities: { ...row.quantities },
    inventoryClassification: !row.sellerSku || !row.fnSku
      ? "UNKNOWN"
      : groupClassification.get(row.fnSku) ?? "UNKNOWN",
  }));

  const sum = (field: OperationalQuantityField) =>
    trustedContributions.reduce((total, row) => total + quantity(row, field), 0);
  const inbound = {
    working: sum("inboundWorkingQuantity"),
    shipped: sum("inboundShippedQuantity"),
    receiving: sum("inboundReceivingQuantity"),
    total: 0,
  };
  inbound.total = inbound.working + inbound.shipped + inbound.receiving;
  const inventoryConfidence = conflictingFnskus.length > 0
    ? "FNSKU_CONFLICT" as const
    : incompleteFnskus.length > 0 || reconciled.some((row) => row.inventoryClassification === "UNKNOWN")
      ? "INCOMPLETE" as const
      : "TRUSTED" as const;
  const asinTotal = inventoryConfidence === "TRUSTED"
    ? sum("totalQuantity")
    : "UNKNOWN" as const;

  return {
    asin,
    availableFba: sum("fulfillableQuantity"),
    reservedFba: sum("totalReservedQuantity"),
    inbound,
    unfulfillableFba: sum("totalUnfulfillableQuantity"),
    researchingFba: sum("totalResearchingQuantity"),
    uniqueFnskuCount: trustedContributions.length,
    sellerSkuRepresentationCount: reconciled.filter((row) => row.sellerSku).length,
    inventoryConfidence,
    conflictingFnskus: conflictingFnskus.sort(),
    incompleteFnskus: incompleteFnskus.sort(),
    rawIdentities: reconciled,
    rows: reconciled,
    asinTotal,
  };
}
