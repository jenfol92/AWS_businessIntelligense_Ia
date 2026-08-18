import assert from "node:assert/strict";
import type { ParsedAmazonFbaLedgerRow } from "./types.ts";

process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";

async function run() {
const { mapLedgerRowsToDbPayload } = await import("./repository.ts");

const base: ParsedAmazonFbaLedgerRow = {
  rowNumber: 2,
  snapshotDate: "2026-08-13",
  skuOriginal: "SELLER-ORIGINAL",
  mskuAliases: ["SELLER-ORIGINAL"],
  skuLimpio: "SELLER-NORMALIZED",
  fnsku: "FNSKU-ONE",
  asin: "ASIN-ONE",
  conditionType: "UNKNOWN",
  title: "A title that must never identify a product",
  disposition: "SELLABLE",
  startingWarehouseBalance: 1,
  inTransitBetweenWarehouses: 0,
  receipts: 0,
  customerShipments: 0,
  customerReturns: 0,
  vendorReturns: 0,
  warehouseTransferInOut: 0,
  found: 0,
  lost: 0,
  damaged: 0,
  disposed: 0,
  otherEvents: 0,
  endingWarehouseBalance: 1,
  unknownEvents: 0,
  location: "ES",
  raw: {},
};

function map(overrides: Partial<Parameters<typeof mapLedgerRowsToDbPayload>[0]> = {}) {
  return mapLedgerRowsToDbPayload({
    rows: [base],
    productoBySku: new Map(),
    source: "TEST",
    sourceFileName: "test.csv",
    reportDocumentId: "DOC",
    manualDocumentHash: null,
    documentIdentityType: "REPORT_DOCUMENT_ID",
    documentIdentity: "report:DOC",
    ...overrides,
  });
}

const asin = map({ productoByAsin: new Map([["ASIN-ONE", "P1"]]) });
assert.equal(asin.dbRows[0]?.producto_id, "P1");
assert.equal(asin.dbRows[0]?.raw.matched_by, "ASIN_UNIQUE");

const fnsku = map({ productoByFnsku: new Map([["FNSKU-ONE", "P1"]]) });
assert.equal(fnsku.dbRows[0]?.producto_id, "P1");
assert.equal(fnsku.dbRows[0]?.raw.matched_by, "FNSKU_UNIQUE");

const pair = map({
  productoByAsin: new Map([["ASIN-ONE", "P1"]]),
  productoByFnsku: new Map([["FNSKU-ONE", "P1"]]),
});
assert.equal(pair.dbRows[0]?.raw.matched_by, "ASIN_FNSKU");

const alias = map({ productoByExistingAlias: new Map([["SELLER-ORIGINAL", "P1"]]) });
assert.equal(alias.dbRows[0]?.raw.matched_by, "EXISTING_ALIAS");

const exact = map({ productoBySku: new Map([["SELLER-ORIGINAL", "P1"]]) });
assert.equal(exact.dbRows[0]?.raw.matched_by, "SELLER_SKU_EXACT");

const normalized = map({ productoBySku: new Map([["SELLER-NORMALIZED", "P1"]]) });
assert.equal(normalized.dbRows[0]?.raw.matched_by, "SELLER_SKU_NORMALIZED");

const ambiguousAsin = map({
  productoByAsin: new Map([["ASIN-ONE", "P1"]]),
  ambiguousAsins: new Set(["ASIN-ONE"]),
});
assert.equal(ambiguousAsin.dbRows[0]?.producto_id, null);

const ambiguousFnsku = map({
  productoByFnsku: new Map([["FNSKU-ONE", "P1"]]),
  ambiguousFnskus: new Set(["FNSKU-ONE"]),
});
assert.equal(ambiguousFnsku.dbRows[0]?.producto_id, null);

const conflicting = map({
  productoByAsin: new Map([["ASIN-ONE", "P1"]]),
  productoByFnsku: new Map([["FNSKU-ONE", "P2"]]),
});
assert.equal(conflicting.conflictRows, 1);
assert.equal(conflicting.dbRows.length, 0);

const titleOnly = map();
assert.equal(titleOnly.dbRows[0]?.producto_id, null);
assert.equal(titleOnly.dbRows[0]?.raw.matched_by, null);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
