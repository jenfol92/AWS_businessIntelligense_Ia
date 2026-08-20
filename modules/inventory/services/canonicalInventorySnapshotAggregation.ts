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
  rowsByFnsku: Map<string, CanonicalInventorySnapshotReadRow>;
  hasFnskuConflict: boolean;
};

function operationalQuantitySignature(row: CanonicalInventorySnapshotReadRow): string {
  return [
    row.fulfillable_quantity,
    row.reserved_quantity,
    row.inbound_total_quantity,
    row.unfulfillable_quantity,
    row.researching_quantity,
  ].map((value) => Number(value ?? 0)).join("|");
}

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
    const run = productRuns.get(runId) ?? {
      snapshotRunId: runId,
      snapshotAt,
      rowsByFnsku: new Map<string, CanonicalInventorySnapshotReadRow>(),
      hasFnskuConflict: false,
    };
    if (snapshotAt > run.snapshotAt) run.snapshotAt = snapshotAt;
    const previous = run.rowsByFnsku.get(fnsku);
    if (!previous) {
      run.rowsByFnsku.set(fnsku, row);
    } else if (operationalQuantitySignature(previous) !== operationalQuantitySignature(row)) {
      run.hasFnskuConflict = true;
    }
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
    if (latestRun.hasFnskuConflict) {
      result.set(productId, {
        snapshotRunId: latestRun.snapshotRunId,
        operationalPool: selectedPool,
        identityConflict: true,
        snapshotAt: latestRun.snapshotAt,
        fulfillableQuantity: 0,
        reservedQuantity: 0,
        inboundQuantity: 0,
        unfulfillableQuantity: 0,
        source: "spapi_fba_inventory_summaries",
      });
      continue;
    }
    const physicalRows = Array.from(latestRun.rowsByFnsku.values());

    result.set(productId, {
      snapshotRunId: latestRun.snapshotRunId,
      operationalPool: selectedPool,
      snapshotAt: latestRun.snapshotAt,
      fulfillableQuantity: physicalRows.reduce(
        (sum, row) => sum + Number(row.fulfillable_quantity ?? 0),
        0,
      ),
      reservedQuantity: physicalRows.reduce(
        (sum, row) => sum + Number(row.reserved_quantity ?? 0),
        0,
      ),
      inboundQuantity: physicalRows.reduce(
        (sum, row) => sum + Number(row.inbound_total_quantity ?? 0),
        0,
      ),
      unfulfillableQuantity: physicalRows.reduce(
        (sum, row) => sum + Number(row.unfulfillable_quantity ?? 0),
        0,
      ),
      source: physicalRows[0]?.source ?? "spapi_fba_inventory_summaries",
    });
  }

  return result;
}
