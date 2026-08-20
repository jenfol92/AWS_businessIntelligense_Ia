import test from "node:test";
import assert from "node:assert/strict";

import { aggregateCanonicalSnapshotByProductPool } from "./canonicalInventorySnapshotAggregation.ts";
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

test("Seller SKU aliases ya deduplicados son provenance y no alteran cantidades", () => {
  const rows = alaiaRows();
  rows[0].seller_sku_aliases = ["alias-a", "alias-b", "alias-c"];
  assert.equal(aggregateCanonicalSnapshotByProductPool(rows, "EU").get("P")?.fulfillableQuantity, 694);
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

test("snapshot fresh gana al legacy", () => {
  const snapshot = aggregateCanonicalSnapshotByProductPool(alaiaRows(), "EU").get("P");
  const inventoryRows = [{ producto_id: "P", pais: "ES", stock_fba: 664, stock_fbm: 0, updated_at: AT }];
  const resolved = buildOperationalStockSummary(inventoryRows, null, snapshot, { now: new Date("2026-08-20T12:00:00Z") });
  assert.equal(resolved.stockOperationalFbaSource, "fba_inventory_snapshot");
  assert.equal(resolved.stockOperationalFba, 694);
  assert.equal(resolved.stockOperationalTotal, 694);
});

test("snapshot ausente conserva fallback legacy fresh", () => {
  const inventoryRows = [{ producto_id: "P", pais: "ES", stock_fba: 664, stock_fbm: 0, updated_at: AT }];
  const resolved = buildOperationalStockSummary(inventoryRows, null, null, { now: new Date("2026-08-20T12:00:00Z") });
  assert.equal(resolved.stockOperationalFbaSource, "country_inventory");
  assert.equal(resolved.stockOperationalFba, 664);
});

test("cantidades distintas entre FNSKU se suman y no producen ambigüedad", () => {
  const stock = aggregateCanonicalSnapshotByProductPool(alaiaRows(), "EU").get("P");
  assert.ok(stock);
  assert.equal(stock.fulfillableQuantity, 694);
});
