export type FnsSkuInventoryObservation = {
  productoId: string;
  operationalPool: string;
  sellerSku: string;
  asin: string;
  fnSku: string;
  fulfillableQuantity: number;
  reservedQuantity: number;
  inboundWorkingQuantity: number;
  inboundShippedQuantity: number;
  inboundReceivingQuantity: number;
  unfulfillableQuantity: number;
  researchingQuantity: number;
  totalQuantity: number;
  raw: Record<string, unknown>;
};

export type CanonicalFnsSkuContributor = {
  identityKey: string;
  productoId: string;
  operationalPool: string;
  fnSku: string;
  asin: string;
  sellerSkus: string[];
  observations: FnsSkuInventoryObservation[];
  status: "CONFIRMED" | "FNSKU_IDENTITY_CONFLICT";
  quantities: Omit<FnsSkuInventoryObservation, "productoId" | "operationalPool" | "sellerSku" | "asin" | "fnSku" | "raw"> | null;
};

const quantityFields = [
  "fulfillableQuantity",
  "reservedQuantity",
  "inboundWorkingQuantity",
  "inboundShippedQuantity",
  "inboundReceivingQuantity",
  "unfulfillableQuantity",
  "researchingQuantity",
  "totalQuantity",
] as const;

function signature(row: FnsSkuInventoryObservation): string {
  return quantityFields.map((field) => row[field]).join("|");
}

function identityKey(row: FnsSkuInventoryObservation): string {
  return `${row.productoId}|${row.asin}|${row.operationalPool}|${row.fnSku}`;
}

export function buildCanonicalFnsSkuContributors(
  rows: readonly FnsSkuInventoryObservation[],
): CanonicalFnsSkuContributor[] {
  const groups = new Map<string, FnsSkuInventoryObservation[]>();
  for (const row of rows) {
    const key = identityKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, observations]) => {
    const first = observations[0];
    const signatures = new Set(observations.map(signature));
    const confirmed = signatures.size === 1;
    const quantities = confirmed
      ? Object.fromEntries(quantityFields.map((field) => [field, first[field]])) as CanonicalFnsSkuContributor["quantities"]
      : null;
    return {
      identityKey: key,
      productoId: first.productoId,
      operationalPool: first.operationalPool,
      asin: first.asin,
      fnSku: first.fnSku,
      sellerSkus: Array.from(new Set(observations.map((row) => row.sellerSku))).sort(),
      observations: [...observations],
      status: confirmed ? "CONFIRMED" : "FNSKU_IDENTITY_CONFLICT",
      quantities,
    };
  });
}

export function sumConfirmedFnsSkuQuantities(
  contributors: readonly CanonicalFnsSkuContributor[],
): { fulfillableQuantity: number; reservedQuantity: number; inboundQuantity: number; rawSellerSkuSum: number } {
  return contributors.reduce((sum, contributor) => {
    sum.rawSellerSkuSum += contributor.observations.reduce((total, row) => total + row.fulfillableQuantity, 0);
    if (contributor.status !== "CONFIRMED" || contributor.quantities == null) return sum;
    sum.fulfillableQuantity += contributor.quantities.fulfillableQuantity;
    sum.reservedQuantity += contributor.quantities.reservedQuantity;
    sum.inboundQuantity += contributor.quantities.inboundWorkingQuantity + contributor.quantities.inboundShippedQuantity + contributor.quantities.inboundReceivingQuantity;
    return sum;
  }, { fulfillableQuantity: 0, reservedQuantity: 0, inboundQuantity: 0, rawSellerSkuSum: 0 });
}
