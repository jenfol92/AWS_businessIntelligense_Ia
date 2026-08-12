import assert from "node:assert/strict";
import {
  dedupeLedgerRowsForUpsert,
  manualLedgerReportDocumentIdFromContent,
} from "./ledgerCanonicalIdentity.ts";
import type { AmazonFbaLedgerDbRow } from "./types.ts";

function row(
  patch: Partial<AmazonFbaLedgerDbRow> = {},
): AmazonFbaLedgerDbRow {
  return {
    producto_id: "product-1",
    sku_original: "MSKU-1",
    msku_aliases: ["MSKU-1"],
    sku_limpio: "SKU-1",
    fnsku: "FNSKU1",
    asin: "ASIN1",
    condition_type: "NEWITEM",
    title: "Product",
    snapshot_date: "2026-07-15",
    disposition: "SELLABLE",
    starting_warehouse_balance: 10,
    in_transit_between_warehouses: 1,
    receipts: 2,
    customer_shipments: 3,
    customer_returns: 4,
    vendor_returns: 5,
    warehouse_transfer_in_out: 6,
    found: 7,
    lost: 8,
    damaged: 9,
    disposed: 10,
    other_events: 11,
    ending_warehouse_balance: 12,
    unknown_events: 13,
    location: "GB",
    location_country: null,
    source: "manual",
    source_file_name: "ledger-a.csv",
    report_document_id: "doc-1",
    raw: {},
    updated_at: "2026-07-15T00:00:00.000Z",
    ...patch,
  };
}

function assertConflict(rows: AmazonFbaLedgerDbRow[], field: string) {
  assert.throws(
    () => dedupeLedgerRowsForUpsert(rows),
    (error) => error instanceof Error && error.message.includes(field),
  );
}

const duplicateDifferentSource = dedupeLedgerRowsForUpsert([
  row({ source: "manual" }),
  row({ source: "scheduler" }),
]);
assert.equal(
  duplicateDifferentSource.length,
  1,
  "duplicado identico con source diferente se fusiona",
);

assertConflict(
  [row(), row({ source: "scheduler", ending_warehouse_balance: 13 })],
  "ending_warehouse_balance",
);

assertConflict(
  [row(), row({ source: "scheduler", customer_returns: 5 })],
  "customer_returns",
);

assertConflict(
  [row(), row({ source: "scheduler", condition_type: "USEDLIKENEW" })],
  "condition_type",
);

assertConflict(
  [row(), row({ source: "scheduler", producto_id: "product-2" })],
  "producto_id",
);

const safeAliases = dedupeLedgerRowsForUpsert([
  row({ msku_aliases: ["MSKU-1"] }),
  row({ source: "scheduler", msku_aliases: ["MSKU-ALT"] }),
]);
assert.equal(safeAliases.length, 1, "duplicado seguro se fusiona");
assert.deepEqual(
  safeAliases[0]?.msku_aliases.sort(),
  ["MSKU-1", "MSKU-ALT"],
  "duplicado seguro conserva aliases MSKU",
);

const csvA = "Date,MSKU,FNSKU,ASIN\n07/15/2026,SKU,FN,ASIN\n";
const csvB = "Date,MSKU,FNSKU,ASIN\n07/16/2026,SKU,FN,ASIN\n";
assert.equal(
  manualLedgerReportDocumentIdFromContent(csvA),
  manualLedgerReportDocumentIdFromContent(csvA),
  "mismo CSV manual con nombres distintos usa el mismo SHA-256",
);
assert.notEqual(
  manualLedgerReportDocumentIdFromContent(csvA),
  manualLedgerReportDocumentIdFromContent(csvB),
  "dos CSV distintos con el mismo nombre no colisionan",
);
