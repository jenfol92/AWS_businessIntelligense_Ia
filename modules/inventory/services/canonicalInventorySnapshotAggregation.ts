import type { LatestFbaInventorySnapshotStock } from "./resolveOperationalStock.ts";

export type CanonicalInventorySnapshotReadRow = {
  snapshot_run_id: string | null;
  producto_id: string | null;
  snapshot_at: string | null;
  operational_pool: string | null;
  fnsku: string | null;
  fulfillable_quantity: number | null;
  reserved_quantity: number | null;
  inbound_total_quantity: number | null;
  unfulfillable_quantity: number | null;
  researching_quantity: number | null;
  source: string | null;
  seller_sku_aliases?: string[] | null;
};

type RunRows = {
  snapshotRunId: string;
  snapshotAt: string;
  rows: CanonicalInventorySnapshotReadRow[];
};

/**
 * The source rows are already canonical physical FNSKU identities. This read
 * model selects one complete run per product/pool and only aggregates it.
 */
export function aggregateCanonicalSnapshotByProductPool(
  rows: readonly CanonicalInventorySnapshotReadRow[],
  operationalPool: string,
): Map<string, LatestFbaInventorySnapshotStock> {
  const selectedPool = operationalPool.trim().toUpperCase();
  const runsByProduct = new Map<string, Map<string, RunRows>>();

  for (const row of rows) {
    const productId = String(row.producto_id ?? "").trim();
    const runId = String(row.snapshot_run_id ?? "").trim();
    const snapshotAt = String(row.snapshot_at ?? "").trim();
    const pool = String(row.operational_pool ?? "").trim().toUpperCase();
    const fnsku = String(row.fnsku ?? "").trim();
    if (!productId || !runId || !snapshotAt || !fnsku || pool !== selectedPool) continue;

    const productRuns = runsByProduct.get(productId) ?? new Map<string, RunRows>();
    const run = productRuns.get(runId) ?? { snapshotRunId: runId, snapshotAt, rows: [] };
    if (snapshotAt > run.snapshotAt) run.snapshotAt = snapshotAt;
    run.rows.push(row);
    productRuns.set(runId, run);
    runsByProduct.set(productId, productRuns);
  }

  const result = new Map<string, LatestFbaInventorySnapshotStock>();
  for (const [productId, productRuns] of Array.from(runsByProduct.entries())) {
    const latestRun = Array.from(productRuns.values()).sort((left, right) =>
      right.snapshotAt.localeCompare(left.snapshotAt) ||
      right.snapshotRunId.localeCompare(left.snapshotRunId),
    )[0];
    if (!latestRun) continue;

    result.set(productId, {
      snapshotRunId: latestRun.snapshotRunId,
      operationalPool: selectedPool,
      snapshotAt: latestRun.snapshotAt,
      fulfillableQuantity: latestRun.rows.reduce(
        (sum, row) => sum + Number(row.fulfillable_quantity ?? 0),
        0,
      ),
      reservedQuantity: latestRun.rows.reduce(
        (sum, row) => sum + Number(row.reserved_quantity ?? 0),
        0,
      ),
      inboundQuantity: latestRun.rows.reduce(
        (sum, row) => sum + Number(row.inbound_total_quantity ?? 0),
        0,
      ),
      unfulfillableQuantity: latestRun.rows.reduce(
        (sum, row) => sum + Number(row.unfulfillable_quantity ?? 0),
        0,
      ),
      source: latestRun.rows[0]?.source ?? "spapi_fba_inventory_summaries",
    });
  }

  return result;
}
