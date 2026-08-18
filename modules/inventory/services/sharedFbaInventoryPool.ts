import type { InventoryFreshness } from "./amazonCanonicalInventory";

export type SharedPoolConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE";

export type SharedPoolSnapshotRow = {
  productId: string | null;
  sku: string;
  marketplaceId: string;
  sellable: number;
  reserved: number;
  inbound: number;
  unfulfillable: number;
  researching: number;
  sourceTimestamp: string;
  freshnessStatus: InventoryFreshness;
};

export type FbaPoolMembershipEvidence = {
  poolId: string;
  marketplaceIds: string[];
  source: string;
  confidence: Exclude<SharedPoolConfidence, "UNAVAILABLE">;
};

export type SharedFbaPool = {
  poolId: string;
  marketplaceIds: string[];
  uniqueSellable: number | null;
  reserved: number | null;
  inbound: number | null;
  unfulfillable: number | null;
  researching: number | null;
  sourceTimestamp: string | null;
  freshnessStatus: InventoryFreshness;
  reliable: boolean;
  confidence: SharedPoolConfidence;
  membershipSource: string | null;
  limitation: string | null;
};

const quantitySignature = (row: SharedPoolSnapshotRow) =>
  [row.sellable, row.reserved, row.inbound, row.unfulfillable, row.researching].join("|");

/**
 * Convierte disponibilidad por marketplace en unidades unicas solo cuando existe
 * evidencia explicita de pertenencia al mismo pool. Las replicas marketplace de
 * un pool se toman una sola vez; nunca se suman.
 */
export function buildSharedFbaPools(
  rows: SharedPoolSnapshotRow[],
  memberships: FbaPoolMembershipEvidence[],
): SharedFbaPool[] {
  const assigned = new Set<string>();
  const pools: SharedFbaPool[] = [];

  for (const membership of memberships) {
    const members = new Set(membership.marketplaceIds);
    const poolRows = rows.filter((row) => members.has(row.marketplaceId));
    if (poolRows.length === 0) continue;
    poolRows.forEach((row) => assigned.add(row.marketplaceId));

    const signatures = new Set(poolRows.map(quantitySignature));
    const newest = poolRows.map((row) => row.sourceTimestamp).sort().at(-1) ?? null;
    const freshness = poolRows.every((row) => row.freshnessStatus === "FRESH")
      ? "FRESH"
      : poolRows.some((row) => row.freshnessStatus === "STALE")
        ? "STALE"
        : poolRows.some((row) => row.freshnessStatus === "AGING")
          ? "AGING"
          : "UNKNOWN";
    const representative = signatures.size === 1 ? poolRows[0] : null;
    const reliable = representative != null && freshness === "FRESH";

    pools.push({
      poolId: membership.poolId,
      marketplaceIds: Array.from(members).sort(),
      uniqueSellable: representative?.sellable ?? null,
      reserved: representative?.reserved ?? null,
      inbound: representative?.inbound ?? null,
      unfulfillable: representative?.unfulfillable ?? null,
      researching: representative?.researching ?? null,
      sourceTimestamp: newest,
      freshnessStatus: freshness,
      reliable,
      confidence: reliable ? membership.confidence : "UNAVAILABLE",
      membershipSource: membership.source,
      limitation: representative
        ? null
        : "Las replicas marketplace del pool no coinciden; no se puede derivar inventario unico sin reconciliacion Amazon.",
    });
  }

  for (const row of rows.filter((candidate) => !assigned.has(candidate.marketplaceId))) {
    pools.push({
      poolId: `UNRESOLVED:${row.marketplaceId}`,
      marketplaceIds: [row.marketplaceId],
      uniqueSellable: null,
      reserved: null,
      inbound: null,
      unfulfillable: null,
      researching: null,
      sourceTimestamp: row.sourceTimestamp,
      freshnessStatus: row.freshnessStatus,
      reliable: false,
      confidence: "UNAVAILABLE",
      membershipSource: null,
      limitation: "Marketplace sin evidencia de pertenencia a un pool FBA unico.",
    });
  }

  return pools;
}
