import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  buildCanonicalInventorySnapshot,
  InventorySnapshotValidationError,
} from "./inventorySummaryCanonicalSnapshot.ts";

const ids = {
  ES: "A1RKKUPIHCS9HS",
  DE: "A1PA6795UKMFR9",
  FR: "A13V1IB3VIYZZH",
  IT: "APJ6JRA9NG5V4",
  PL: "A1C3SOZRARQ6R3",
  SE: "A2NODRKZP88ZB9",
};

const observation = ({
  marketplace = ids.ES,
  sellerSku,
  fnSku,
  available,
  reserved = 0,
  shipped = 0,
  working = 0,
  receiving = 0,
  unfulfillable = 0,
  researching = 0,
  lastUpdatedTime = "2026-08-13T17:36:07Z",
}) => ({
  marketplaceId: marketplace,
  asin: "B0DJBQGKBT",
  sellerSku,
  fnSku,
  lastUpdatedTime,
  totalQuantity: available + reserved + shipped + working + receiving + unfulfillable,
  inventoryDetails: {
    fulfillableQuantity: available,
    reservedQuantity: {
      totalReservedQuantity: reserved,
      pendingCustomerOrderQuantity: 0,
      pendingTransshipmentQuantity: 0,
      fcProcessingQuantity: reserved,
    },
    inboundWorkingQuantity: working,
    inboundShippedQuantity: shipped,
    inboundReceivingQuantity: receiving,
    unfulfillableQuantity: { totalUnfulfillableQuantity: unfulfillable },
    researchingQuantity: { totalResearchingQuantity: researching },
  },
});

const alaia = (marketplace = ids.ES) => [
  observation({ marketplace, sellerSku: "f8436616610104", fnSku: "X00259GEWP", available: 84, reserved: 5, unfulfillable: 5 }),
  observation({ marketplace, sellerSku: "f8436616610104UK", fnSku: "B0DJBQGKBT", available: 624, reserved: 3, shipped: 669 }),
  observation({ marketplace, sellerSku: "Amazon.Found.B0DJBQGKBT", fnSku: "B0DJBQGKBT", available: 624, reserved: 3, shipped: 669 }),
];

const matches = new Map([
  ["NO-TIMESTAMP", { productoId: "11111111-1111-1111-1111-111111111111", skuLimpio: "ALAIA", matchedBy: "test", candidates: [] }],
  ["EMPTY-TIMESTAMP", { productoId: "11111111-1111-1111-1111-111111111111", skuLimpio: "ALAIA", matchedBy: "test", candidates: [] }],
  ["TEST-THIRD", { productoId: "11111111-1111-1111-1111-111111111111", skuLimpio: "ALAIA", matchedBy: "test", candidates: [] }],
  ["f8436616610104", { productoId: "11111111-1111-1111-1111-111111111111", skuLimpio: "ALAIA", matchedBy: "test", candidates: [] }],
  ["f8436616610104UK", { productoId: "11111111-1111-1111-1111-111111111111", skuLimpio: "ALAIA", matchedBy: "test", candidates: [] }],
  ["Amazon.Found.B0DJBQGKBT", { productoId: "11111111-1111-1111-1111-111111111111", skuLimpio: "ALAIA", matchedBy: "test", candidates: [] }],
]);

const build = (observations) => buildCanonicalInventorySnapshot({
  observations,
  productMatches: matches,
  observedAt: "2026-08-14T08:00:00Z",
  snapshotRunId: "22222222-2222-2222-2222-222222222222",
});

const totals = (rows) => rows.reduce((sum, row) => ({
  available: sum.available + row.fulfillable_quantity,
  reserved: sum.reserved + row.reserved_quantity,
  inbound: sum.inbound + row.inbound_total_quantity,
}), { available: 0, reserved: 0, inbound: 0 });

test("ALAIA conserva aliases raw pero canonicaliza una vez por FNSKU", () => {
  const result = build(alaia());
  assert.equal(result.rows.length, 2);
  assert.deepEqual(totals(result.rows), { available: 708, reserved: 8, inbound: 669 });
  assert.deepEqual(result.rows.find((row) => row.fnsku === "B0DJBQGKBT").seller_sku_aliases, ["Amazon.Found.B0DJBQGKBT", "f8436616610104UK"]);
});

test("marketplaces remain independent raw grains", () => {
  const observations = Object.values(ids).flatMap((marketplace) => alaia(marketplace));
  const result = build(observations);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.every((row) => row.observed_marketplaces.length === 6), true);
});

test("a distinct FNSKU remains an independent contribution", () => {
  const third = observation({ sellerSku: "TEST-THIRD", fnSku: "FNSKU-THIRD", available: 10, shipped: 20 });
  const result = build([...alaia(), third]);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(totals(result.rows), { available: 718, reserved: 8, inbound: 689 });
});

test("incompatible signatures abort before any row can be committed", () => {
  const conflict = observation({ sellerSku: "f8436616610104UK", fnSku: "B0DJBQGKBT", available: 625, reserved: 3, shipped: 669 });
  assert.throws(
    () => build([...alaia(), conflict]),
    (error) => error instanceof InventorySnapshotValidationError && error.code === "FNSKU_CONFLICT",
  );
});

test("InventorySummary válido sin lastUpdatedTime conserva raw y no aborta", () => {
  const result = build([
    observation({ sellerSku: "NO-TIMESTAMP", fnSku: "FNSKU-T", available: 4, lastUpdatedTime: null }),
    observation({ sellerSku: "EMPTY-TIMESTAMP", fnSku: "FNSKU-E", available: 2, lastUpdatedTime: "" }),
    ...alaia(),
  ]);
  assert.equal(result.rows.find((item) => item.seller_sku_original === "NO-TIMESTAMP")?.amazon_last_updated_time, null);
  assert.equal(result.rows.find((item) => item.seller_sku_original === "EMPTY-TIMESTAMP")?.amazon_last_updated_time, null);
  assert.equal(result.incompleteObservations.length, 0);
});

test("faltan FNSKU o ASIN: raw queda aceptado pero fuera del canonical", () => {
  const missingFnSku = observation({ sellerSku: "MISSING-FNSKU", fnSku: undefined, available: 7 });
  const missingAsin = { ...observation({ sellerSku: "MISSING-ASIN", fnSku: "FNSKU-A", available: 8 }), asin: undefined };
  const result = build([missingFnSku, missingAsin, ...alaia()]);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.incompleteObservations.map((item) => item.sellerSku).sort(), ["MISSING-ASIN", "MISSING-FNSKU"]);
  assert.match(result.warnings.join("\n"), /IDENTITY_INCOMPLETE/);
});

test("Seller SKU mantiene trazabilidad; sin Seller SKU se rechaza la respuesta", () => {
  const missingSellerSku = observation({ sellerSku: undefined, fnSku: "FNSKU-X", available: 1 });
  assert.throws(() => build([missingSellerSku]), /sin Seller SKU/);
});

test("fila incompleta no invalida otras filas válidas ni entra en cantidades", () => {
  const incomplete = observation({ sellerSku: "UNKNOWN-IDENTITY", fnSku: undefined, available: 99 });
  const result = build([incomplete, alaia()[0]]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].fulfillable_quantity, 84);
  assert.equal(result.incompleteObservations[0].status, "IDENTITY_INCOMPLETE");
});

test("caso real amzn.gr queda explícitamente incompleto sin inventar identidad", () => {
  const result = build([observation({ sellerSku: "amzn.gr.UK8436616610289-hfDxVSDTlJZy5-LN", fnSku: undefined, available: 0 })]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.incompleteObservations[0].sellerSku, "amzn.gr.UK8436616610289-hfDxVSDTlJZy5-LN");
  assert.equal(result.incompleteObservations[0].status, "IDENTITY_INCOMPLETE");
});

test("writer publishes only through the atomic run RPC", async () => {
  const source = await readFile("modules/amazon-sp-api/fbaForecastSpApiImportsService.ts", "utf8");
  const migration = await readFile("sql/migrations/20260817_02_inventory_summary_marketplace_grain.sql", "utf8");
  assert.match(source, /buildCanonicalInventorySnapshot/);
  assert.match(source, /commit_amazon_fba_inventory_snapshot_run/);
  assert.doesNotMatch(source.slice(source.indexOf("export async function importFbaInventorySnapshotFromSpApi")), /upsertRows\(\s*"amazon_fba_inventory_snapshots"/);
  assert.match(migration, /snapshot_run_id, seller_sku_original, marketplace_id, asin, fnsku/);
  assert.match(migration, /p_run_id, p_observed_at, 'COMPLETE'/);
  assert.match(migration, /inbound_total_quantity = inbound_working_quantity \+ inbound_shipped_quantity \+ inbound_receiving_quantity/);
});

test("production publication fails closed on ASIN identity conflicts", async () => {
  const source = await readFile("modules/amazon-sp-api/fbaForecastSpApiImportsService.ts", "utf8");
  const conflictGuard = source.indexOf("publicationSummary.asinIdentityConflicts > 0");
  const atomicCommit = source.indexOf('"commit_amazon_fba_inventory_snapshot_run"');
  assert.ok(conflictGuard >= 0);
  assert.ok(atomicCommit > conflictGuard);
});

test("product/pool read model exposes pool provenance and PAN_EU plus UK total", async () => {
  const migration = await readFile("sql/migrations/20260817_02_inventory_summary_marketplace_grain.sql", "utf8");
  const readModel = await readFile("modules/inventory/services/amazonCanonicalInventoryReadModel.ts", "utf8");
  assert.match(migration, /v_latest_amazon_fba_inventory_by_product_marketplace/);
  assert.match(migration, /sum\(fulfillable_quantity\).*fba_available/);
  assert.match(readModel, /stockFbaPanEu/);
  assert.match(readModel, /stockFbaUk/);
  assert.match(readModel, /stockFbaTotal/);
  assert.doesNotMatch(readModel, /\.from\([^\n]*ledger/i);
});

test("detailed read model is marketplace-grained and country flow remains separate", async () => {
  const migration = await readFile("sql/migrations/20260817_02_inventory_summary_marketplace_grain.sql", "utf8");
  const importer = await readFile("modules/amazon-sp-api/fbaForecastSpApiImportsService.ts", "utf8");
  assert.match(migration, /v_latest_amazon_fba_inventory_by_product_marketplace/);
  assert.match(migration, /GROUP BY producto_id, sku_limpio, marketplace_id/);
  assert.doesNotMatch(importer, /inventario_paises/);
  assert.doesNotMatch(importer, /GET_AFN_INVENTORY_DATA_BY_COUNTRY/);
});
