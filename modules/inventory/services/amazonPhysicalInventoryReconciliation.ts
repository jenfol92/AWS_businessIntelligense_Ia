export const FBA_POOL_EU_COUNTRIES = ["ES", "DE", "FR", "IT", "PL", "SE"] as const;
export const FBA_POOL_UK_COUNTRIES = ["GB"] as const;

export type FbaOperationalPoolId = "FBA_POOL_EU" | "FBA_POOL_UK";
export type PhysicalReconciliationStatus =
  | "MATCHED"
  | "TIMING_DIFFERENCE"
  | "STALE_PHYSICAL_SOURCE"
  | "INCOMPLETE_LOCATION"
  | "IDENTITY_CONFLICT"
  | "UNEXPLAINED_DIFFERENCE";

export type PhysicalLedgerIdentity = {
  asin: string;
  fnSku: string;
  sellerSkuRepresentations: string[];
  location: string | null;
  locationCountry: string | null;
  disposition: string;
  quantity: number;
  snapshotAt: string;
};

export type NormalizedPhysicalIdentity = PhysicalLedgerIdentity & {
  country: string | "UNKNOWN_LOCATION";
  fulfillmentCenter: string | null;
  poolId: FbaOperationalPoolId | null;
  identityClassification: "UNIQUE_PHYSICAL_INVENTORY" | "DUPLICATE_REPRESENTATION";
};

export type PhysicalInventoryAggregate = {
  asin: string;
  rows: NormalizedPhysicalIdentity[];
  sellableByPoolCountry: Record<string, number>;
  unsellableByPoolCountry: Record<string, number>;
  physicalSellableKnownByPool: Record<FbaOperationalPoolId, number>;
  unknownLocationQuantity: number;
  physicalObservedAt: string | null;
  identityConflicts: Array<{ grain: string; quantities: number[] }>;
};

export type OperationalPoolObservation = {
  poolId: FbaOperationalPoolId;
  available: number;
  observedAt: string;
};

export type PoolPhysicalReconciliation = {
  poolId: FbaOperationalPoolId;
  operationalAvailable: number;
  physicalSellableKnown: number;
  difference: number;
  operationalObservedAt: string;
  physicalObservedAt: string | null;
  ageDifferenceHours: number | null;
  reconciliationStatus: PhysicalReconciliationStatus;
};

function normalized(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function countryCode(value: string | null | undefined): string | null {
  const code = normalized(value);
  if (code === "UK") return "GB";
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function fbaPoolForPhysicalCountry(country: string): FbaOperationalPoolId | null {
  if ((FBA_POOL_EU_COUNTRIES as readonly string[]).includes(country)) return "FBA_POOL_EU";
  if ((FBA_POOL_UK_COUNTRIES as readonly string[]).includes(country)) return "FBA_POOL_UK";
  return null;
}

/** Country hints win; FC-like values are retained as FC and never promoted to country. */
export function normalizeAmazonPhysicalLocation(input: {
  location: string | null;
  locationCountry: string | null;
}): { country: string | "UNKNOWN_LOCATION"; fulfillmentCenter: string | null } {
  const hintedCountry = countryCode(input.locationCountry);
  const locationCountry = countryCode(input.location);
  const rawLocation = normalized(input.location);
  const country = hintedCountry ?? locationCountry ?? "UNKNOWN_LOCATION";
  return {
    country,
    fulfillmentCenter: rawLocation && !locationCountry ? rawLocation : null,
  };
}

function physicalGrain(row: NormalizedPhysicalIdentity): string {
  return [
    row.asin,
    row.fnSku,
    row.snapshotAt,
    row.country,
    row.fulfillmentCenter ?? "",
    normalized(row.disposition) || "UNKNOWN",
  ].join("||");
}

export function aggregatePhysicalInventoryByUniqueFnsku(
  asin: string,
  inputRows: readonly PhysicalLedgerIdentity[],
): PhysicalInventoryAggregate {
  const normalizedRows = inputRows
    .filter((row) => normalized(row.asin) === normalized(asin))
    .map((row): NormalizedPhysicalIdentity => {
      const location = normalizeAmazonPhysicalLocation(row);
      return {
        ...row,
        asin: normalized(row.asin),
        fnSku: normalized(row.fnSku),
        disposition: normalized(row.disposition) || "UNKNOWN",
        sellerSkuRepresentations: Array.from(new Set(row.sellerSkuRepresentations.filter(Boolean))).sort(),
        ...location,
        poolId: fbaPoolForPhysicalCountry(location.country),
        identityClassification: "UNIQUE_PHYSICAL_INVENTORY",
      };
    });
  const groups = new Map<string, NormalizedPhysicalIdentity[]>();
  for (const row of normalizedRows) {
    const grain = physicalGrain(row);
    const group = groups.get(grain) ?? [];
    group.push(row);
    groups.set(grain, group);
  }

  const rows: NormalizedPhysicalIdentity[] = [];
  const identityConflicts: PhysicalInventoryAggregate["identityConflicts"] = [];
  for (const [grain, group] of Array.from(groups.entries())) {
    const quantities = Array.from(new Set(group.map((row) => row.quantity)));
    if (quantities.length > 1) {
      identityConflicts.push({ grain, quantities: quantities.sort((a, b) => a - b) });
      continue;
    }
    const first = group[0];
    if (!first) continue;
    rows.push({
      ...first,
      sellerSkuRepresentations: Array.from(
        new Set(group.flatMap((row) => row.sellerSkuRepresentations)),
      ).sort(),
      identityClassification: group.length > 1
        ? "DUPLICATE_REPRESENTATION"
        : "UNIQUE_PHYSICAL_INVENTORY",
    });
  }

  const sellableByPoolCountry: Record<string, number> = {};
  const unsellableByPoolCountry: Record<string, number> = {};
  const physicalSellableKnownByPool = { FBA_POOL_EU: 0, FBA_POOL_UK: 0 };
  let unknownLocationQuantity = 0;
  for (const row of rows) {
    if (row.country === "UNKNOWN_LOCATION" || !row.poolId) {
      unknownLocationQuantity += row.quantity;
      continue;
    }
    const target = row.disposition === "SELLABLE" ? sellableByPoolCountry : unsellableByPoolCountry;
    const key = `${row.poolId}:${row.country}`;
    target[key] = (target[key] ?? 0) + row.quantity;
    if (row.disposition === "SELLABLE") {
      physicalSellableKnownByPool[row.poolId] += row.quantity;
    }
  }
  const physicalObservedAt = rows.map((row) => row.snapshotAt).sort().at(-1) ?? null;
  return {
    asin: normalized(asin),
    rows,
    sellableByPoolCountry,
    unsellableByPoolCountry,
    physicalSellableKnownByPool,
    unknownLocationQuantity,
    physicalObservedAt,
    identityConflicts,
  };
}

export function reconcileOperationalPoolWithPhysical(params: {
  operational: OperationalPoolObservation;
  physical: PhysicalInventoryAggregate;
  now?: Date;
  staleAfterHours?: number;
  timingDifferenceAfterHours?: number;
}): PoolPhysicalReconciliation {
  const physicalKnown = params.physical.physicalSellableKnownByPool[params.operational.poolId];
  const difference = params.operational.available - physicalKnown;
  const physicalAt = params.physical.physicalObservedAt;
  const operationalMs = new Date(params.operational.observedAt).getTime();
  const physicalMs = physicalAt ? new Date(physicalAt).getTime() : Number.NaN;
  const ageDifferenceHours = Number.isFinite(operationalMs) && Number.isFinite(physicalMs)
    ? Math.abs(operationalMs - physicalMs) / 3_600_000
    : null;
  const now = params.now ?? new Date();
  const physicalAgeHours = Number.isFinite(physicalMs)
    ? (now.getTime() - physicalMs) / 3_600_000
    : Number.POSITIVE_INFINITY;
  let reconciliationStatus: PhysicalReconciliationStatus;
  if (params.physical.identityConflicts.length > 0) reconciliationStatus = "IDENTITY_CONFLICT";
  else if (!physicalAt || physicalAgeHours > (params.staleAfterHours ?? 72)) reconciliationStatus = "STALE_PHYSICAL_SOURCE";
  else if (params.physical.unknownLocationQuantity > 0) reconciliationStatus = "INCOMPLETE_LOCATION";
  else if (difference === 0) reconciliationStatus = "MATCHED";
  else if (ageDifferenceHours != null && ageDifferenceHours > (params.timingDifferenceAfterHours ?? 24)) {
    reconciliationStatus = "TIMING_DIFFERENCE";
  } else reconciliationStatus = "UNEXPLAINED_DIFFERENCE";

  return {
    poolId: params.operational.poolId,
    operationalAvailable: params.operational.available,
    physicalSellableKnown: physicalKnown,
    difference,
    operationalObservedAt: params.operational.observedAt,
    physicalObservedAt: physicalAt,
    ageDifferenceHours,
    reconciliationStatus,
  };
}
