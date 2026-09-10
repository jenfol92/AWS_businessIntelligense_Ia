import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregateCanonicalSnapshotAcrossOperationalPools,
  aggregateCanonicalSnapshotByProductPool,
} from "./canonicalInventorySnapshotAggregation.ts";
import { buildOperationalStockSummary } from "./resolveOperationalStock.ts";

const RUN = "0ed53451-dd61-4dc0-9037-50ba64d0e688";
const AT = "2026-08-20T08:10:50.351Z";

function row({
  run = RUN,
  at = AT,
  pool = "EU",
  fnsku,
  fulfillable,
  reserved = 0,
  pendingTransshipment = 0,
  inbound = 0,
  unfulfillable = 0,
  aliases = [],
}) {
  return {
    snapshot_run_id: run,
    producto_id: "P",
    snapshot_at: at,
    operational_pool: pool,
    fnsku,
    seller_sku_aliases: aliases,
    fulfillable_quantity: fulfillable,
    reserved_quantity: reserved,
    pending_transshipment_quantity: pendingTransshipment,
    inbound_total_quantity: inbound,
    unfulfillable_quantity: unfulfillable,
    researching_quantity: 0,
    source: "spapi_fba_inventory_summaries",
  };
}

const alaiaRows = () => [
  row({ fnsku: "B0DJBQGKBT", fulfillable: 644, reserved: 2, inbound: 633, aliases: ["Amazon.Found.B0DJBQGKBT"] }),
  row({ fnsku: "X00259GEWP", fulfillable: 50, reserved: 3, unfulfillable: 5, aliases: ["f8436616610104"] }),
];

test("ALAIA suma 644 + 50 como dos FNSKU canónicos del mismo producto/pool/run", () => {
  const stock = aggregateCanonicalSnapshotByProductPool(alaiaRows(), "EU").get("P");
  assert.equal(stock?.fulfillableQuantity, 694);
  assert.equal(stock?.reservedQuantity, 5);
  assert.equal(stock?.inboundQuantity, 633);
  assert.equal(stock?.unfulfillableQuantity, 5);
  assert.equal(stock?.snapshotRunId, RUN);
});
test("MOVITY incorpora pending transshipment al stock operativo por pool", () => {
  const snapshot = aggregateCanonicalSnapshotAcrossOperationalPools([
    row({
      pool: "EU",
      fnsku: "B0GTZGM7TP",
      fulfillable: 59,
      reserved: 132,
      pendingTransshipment: 129,
      inbound: 1,
    }),
    row({
      pool: "UK",
      fnsku: "B0GTZGM7TP",
      fulfillable: 235,
      reserved: 0,
      pendingTransshipment: 0,
    }),
  ]).get("P");

  assert.ok(snapshot);

  assert.equal(snapshot.fulfillableQuantity, 294);
  assert.equal(snapshot.pendingTransshipmentQuantity, 129);

  assert.equal(snapshot.stockFbaPanEu, 188);
  assert.equal(snapshot.stockFbaUk, 235);
  assert.equal(snapshot.stockFbaTotal, 423);
});
test("MOVITY total operativo suma FBA físico más FBM", () => {
  const snapshot = aggregateCanonicalSnapshotAcrossOperationalPools([
    row({
      pool: "EU",
      fnsku: "B0GTZGM7TP",
      fulfillable: 59,
      reserved: 132,
      pendingTransshipment: 129,
    }),
    row({
      pool: "UK",
      fnsku: "B0GTZGM7TP",
      fulfillable: 235,
      pendingTransshipment: 0,
    }),
  ]).get("P");

  const resolved = buildOperationalStockSummary(
    [],
    null,
    snapshot,
    { now: new Date("2026-08-20T12:00:00Z") },
    {
      availableQuantity: 182,
      observedAt: AT,
    },
  );

  assert.equal(resolved.stockOperationalFba, 423);
  assert.equal(resolved.stockOperationalFbm, 182);
  assert.equal(resolved.stockOperationalTotal, 605);
});

test("Seller SKU aliases ya deduplicados son provenance y no alteran cantidades", () => {
  const rows = alaiaRows();
  rows[0].seller_sku_aliases = ["alias-a", "alias-b", "alias-c"];
  assert.equal(aggregateCanonicalSnapshotByProductPool(rows, "EU").get("P")?.fulfillableQuantity, 694);
});

test("el mismo FNSKU repetido en el mismo run se cuenta una sola vez", () => {
  const first = row({ fnsku: "B0DJBQGKBT", fulfillable: 644, reserved: 2, inbound: 633 });
  const duplicate = { ...first, seller_sku_aliases: ["otro-alias-del-mismo-fnsku"] };
  const stock = aggregateCanonicalSnapshotByProductPool([first, duplicate], "EU").get("P");
  assert.equal(stock?.fulfillableQuantity, 644);
  assert.equal(stock?.reservedQuantity, 2);
  assert.equal(stock?.inboundQuantity, 633);
});

test("EU y UK nunca se mezclan", () => {
  const rows = [...alaiaRows(), row({ pool: "UK", fnsku: "UK-FNSKU", fulfillable: 826 })];
  assert.equal(aggregateCanonicalSnapshotByProductPool(rows, "EU").get("P")?.fulfillableQuantity, 694);
  assert.equal(aggregateCanonicalSnapshotByProductPool(rows, "UK").get("P")?.fulfillableQuantity, 826);
});

test("snapshot_run_id distintos no se mezclan y gana el run más reciente", () => {
  const rows = [
    row({ run: "old-run", at: "2026-08-19T08:00:00Z", fnsku: "OLD", fulfillable: 664 }),
    ...alaiaRows(),
  ];
  const stock = aggregateCanonicalSnapshotByProductPool(rows, "EU").get("P");
  assert.equal(stock?.snapshotRunId, RUN);
  assert.equal(stock?.fulfillableQuantity, 694);
});

test("snapshot FBA canónico gana al legacy y FBM desconocido permanece null", () => {
  const snapshot = aggregateCanonicalSnapshotByProductPool(alaiaRows(), "EU").get("P");
  const inventoryRows = [{ producto_id: "P", pais: "ES", stock_fba: 664, stock_fbm: 0, updated_at: AT }];
  const resolved = buildOperationalStockSummary(inventoryRows, null, snapshot, { now: new Date("2026-08-20T12:00:00Z") });
  assert.equal(resolved.stockOperationalFbaSource, "fba_inventory_snapshot");
  assert.equal(resolved.stockOperationalFba, 694);
  assert.equal(resolved.stockOperationalFbm, null);
  assert.equal(resolved.stockOperationalTotal, null);
});

test("snapshot ausente no recupera fallback legacy", () => {
  const inventoryRows = [{ producto_id: "P", pais: "ES", stock_fba: 664, stock_fbm: 0, updated_at: AT }];
  const resolved = buildOperationalStockSummary(inventoryRows, null, null, { now: new Date("2026-08-20T12:00:00Z") });
  assert.equal(resolved.stockOperationalFbaSource, "none");
  assert.equal(resolved.stockOperationalFba, 0);
});

test("FBM canónico habilita total operativo sin leer stock_fbm legacy", () => {
  const snapshot = aggregateCanonicalSnapshotByProductPool(alaiaRows(), "EU").get("P");
  const inventoryRows = [{ producto_id: "P", pais: "ES", stock_fba: 664, stock_fbm: 999, updated_at: AT }];
  const resolved = buildOperationalStockSummary(inventoryRows, null, snapshot, { now: new Date("2026-08-20T12:00:00Z") }, { availableQuantity: 7, observedAt: AT });
  assert.equal(resolved.stockOperationalFbm, 7);
  assert.equal(resolved.stockOperationalTotal, 701);
});

test("cantidades distintas entre FNSKU se suman y no producen ambigüedad", () => {
  const stock = aggregateCanonicalSnapshotByProductPool(alaiaRows(), "EU").get("P");
  assert.ok(stock);
  assert.equal(stock.fulfillableQuantity, 694);
});

test("el mismo FNSKU con cantidades divergentes falla cerrado", () => {
  const rows = [
    row({ fnsku: "CONFLICT", fulfillable: 10 }),
    row({ fnsku: "CONFLICT", fulfillable: 11 }),
  ];
  const snapshot = aggregateCanonicalSnapshotByProductPool(rows, "EU").get("P");
  assert.equal(snapshot?.identityConflict, true);

  const legacy = [{ producto_id: "P", pais: "ES", stock_fba: 664, stock_fbm: 0, updated_at: AT }];
  const resolved = buildOperationalStockSummary(legacy, null, snapshot, {
    now: new Date("2026-08-20T12:00:00Z"),
  });
  assert.equal(resolved.stockOperationalFbaSource, "none");
  assert.equal(resolved.stockOperationalFba, 0);
});

test("read model conserva PAN_EU, UK y total del mismo run", () => {
  const rows = [
    ...alaiaRows(),
    row({ pool: "UK", fnsku: "B0DJBQGKBT", fulfillable: 220 }),
    row({ pool: "UK", fnsku: "X00259GEWP", fulfillable: 98 }),
  ];
  const snapshot = aggregateCanonicalSnapshotAcrossOperationalPools(rows).get("P");
  assert.equal(snapshot?.stockFbaPanEu, 694);
  assert.equal(snapshot?.stockFbaUk, 318);
  assert.equal(snapshot?.stockFbaTotal, 1012);
  assert.equal(snapshot?.fulfillableQuantity, 1012);
  assert.equal(snapshot?.dualPoolComplete, true);
});

test("ALAIA real: une por producto_id y conserva 498 PAN_EU + 279 UK", () => {
  const rows = [
    row({ fnsku: "B0DJBQGKBT", fulfillable: 498, reserved: 12, inbound: 633 }),
    row({ fnsku: "X00259GEWP", fulfillable: 0, reserved: 3 }),
    row({ pool: "UK", fnsku: "B0DJBQGKBT", fulfillable: 184, reserved: 3 }),
    row({ pool: "UK", fnsku: "X00259GEWP", fulfillable: 95, reserved: 0 }),
  ];
  const snapshots = aggregateCanonicalSnapshotAcrossOperationalPools(rows);
  assert.equal(snapshots.has("P"), true);
  const snapshot = snapshots.get("P");
  assert.equal(snapshot?.stockFbaPanEu, 498);
  assert.equal(snapshot?.stockFbaUk, 279);
  assert.equal(snapshot?.fulfillableQuantity, 777);
  assert.equal(snapshot?.dualPoolComplete, true);
  const resolved = buildOperationalStockSummary(
    [{ producto_id: "P", pais: "ES", stock_fba: 9999, stock_fbm: 9999, updated_at: AT }],
    { snapshotDate: "2026-08-13", stockSellable: 9999, stockTotal: 9999 },
    snapshot,
    { now: new Date("2026-08-20T12:00:00Z") },
  );
  assert.equal(resolved.stockOperationalFba, 777);
  assert.equal(resolved.stockOperationalFbaSource, "fba_inventory_snapshot");
  assert.equal(resolved.stockOperationalFbm, null);
});

test("read model no mezcla pools pertenecientes a snapshot_run_id distintos", () => {
  const rows = [
    ...alaiaRows(),
    row({ run: "new-run", at: "2026-08-21T08:00:00Z", pool: "UK", fnsku: "UK", fulfillable: 318 }),
  ];
  const snapshot = aggregateCanonicalSnapshotAcrossOperationalPools(rows).get("P");
  assert.equal(snapshot?.snapshotRunId, "new-run");
  assert.equal(snapshot?.stockFbaPanEu, 0);
  assert.equal(snapshot?.stockFbaUk, 318);
  assert.equal(snapshot?.dualPoolComplete, false);
});

test("read model dual mantiene fail-closed ante conflicto real dentro de un pool", () => {
  const rows = [
    row({ fnsku: "CONFLICT", fulfillable: 10 }),
    row({ fnsku: "CONFLICT", fulfillable: 11 }),
    row({ pool: "UK", fnsku: "CONFLICT", fulfillable: 5 }),
  ];
  const snapshot = aggregateCanonicalSnapshotAcrossOperationalPools(rows).get("P");
  assert.equal(snapshot?.identityConflict, true);
  assert.equal(snapshot?.fulfillableQuantity, 0);
});
