import assert from "node:assert/strict";
import { parseAmazonFbaLedgerSummaryText } from "./parser.ts";
import {
  dedupeLedgerRowsForUpsert,
  prepareLedgerRowsAgainstPersisted,
  resolveLedgerDocumentIdentity,
} from "./ledgerCanonicalIdentity.ts";
import { classifyLedgerLocation } from "./ledgerLocationContract.ts";
import type { AmazonFbaLedgerDbRow, ParsedAmazonFbaLedgerRow } from "./types.ts";

const header = [
  "Date", "MSKU", "FNSKU", "ASIN", "Condition Type", "Disposition", "Location",
  "Starting Warehouse Balance", "Ending Warehouse Balance",
].join(",");
const fixture = [
  header,
  "08/14/2026,TEST_LEDGER_SELLER_A,FNSKU_TEST_A,ASIN_TEST_LEDGER,UNKNOWN,SELLABLE,ES,10,12",
  "08/14/2026,TEST_LEDGER_SELLER_A,FNSKU_TEST_A,ASIN_TEST_LEDGER,UNKNOWN,SELLABLE,ES,10,12",
  "08/14/2026,TEST_LEDGER_SELLER_ALIAS,FNSKU_TEST_A,ASIN_TEST_LEDGER,UNKNOWN,SELLABLE,ES,10,12",
  "08/14/2026,TEST_LEDGER_SELLER_B,FNSKU_TEST_B,ASIN_TEST_LEDGER,UNKNOWN,SELLABLE,ES,20,21",
  "08/14/2026,TEST_LEDGER_SELLER_A,FNSKU_TEST_A,ASIN_TEST_LEDGER,UNKNOWN,SELLABLE,CZ,3,4",
  "08/14/2026,TEST_LEDGER_SELLER_A,FNSKU_TEST_A,ASIN_TEST_LEDGER,NEW,SELLABLE,ES,5,6",
  "08/14/2026,TEST_LEDGER_SELLER_A,FNSKU_TEST_A,ASIN_TEST_LEDGER,UNKNOWN,SELLABLE,MAD6,7,8",
  "08/14/2026,TEST_LEDGER_SELLER_A,FNSKU_TEST_A,ASIN_TEST_LEDGER,UNKNOWN,UNSELLABLE,MXP3,1,2",
].join("\n");

async function run() {
const identityA = resolveLedgerDocumentIdentity({ text: fixture });
const parsed = await parseAmazonFbaLedgerSummaryText(fixture);
assert.equal(parsed.warnings.length, 0);
assert.equal(parsed.validRows.length, 8);

const evidence = {
  knownCountryCodes: new Set(["ES", "CZ"]),
  fulfillmentCenters: new Set(["MAD6"]),
};

function dbRow(row: ParsedAmazonFbaLedgerRow): AmazonFbaLedgerDbRow {
  const location = classifyLedgerLocation(row.location, evidence);
  return {
    producto_id: null,
    sku_original: row.skuOriginal,
    msku_aliases: row.mskuAliases,
    sku_limpio: row.skuLimpio,
    fnsku: row.fnsku ?? "",
    asin: row.asin ?? "",
    condition_type: row.conditionType ?? "UNKNOWN",
    title: row.title,
    snapshot_date: row.snapshotDate,
    disposition: row.disposition,
    starting_warehouse_balance: row.startingWarehouseBalance,
    in_transit_between_warehouses: row.inTransitBetweenWarehouses,
    receipts: row.receipts,
    customer_shipments: row.customerShipments,
    customer_returns: row.customerReturns,
    vendor_returns: row.vendorReturns,
    warehouse_transfer_in_out: row.warehouseTransferInOut,
    found: row.found,
    lost: row.lost,
    damaged: row.damaged,
    disposed: row.disposed,
    other_events: row.otherEvents,
    ending_warehouse_balance: row.endingWarehouseBalance,
    unknown_events: row.unknownEvents,
    location: location.locationRaw,
    location_raw: location.locationRaw,
    location_type: location.locationType,
    physical_country: location.physicalCountry,
    location_evidence_source: location.evidenceSource,
    location_evidence_confidence: location.evidenceConfidence,
    location_country: location.physicalCountry,
    source: "TEST_LEDGER_WRITER",
    source_file_name: "TEST_LEDGER_FIXTURE.csv",
    report_document_id: identityA.reportDocumentId,
    manual_document_hash: identityA.manualDocumentHash,
    document_identity_type: identityA.documentIdentityType,
    document_identity: identityA.documentIdentity,
    raw: row.raw,
    updated_at: "2026-08-14T00:00:00.000Z",
  };
}

const canonical = dedupeLedgerRowsForUpsert(parsed.validRows.map(dbRow));
assert.equal(canonical.length, 6, "exact duplicate and Seller SKU alias share one grain");
const esUnknown = canonical.find((row) =>
  row.fnsku === "FNSKU_TEST_A" && row.location_raw === "ES" && row.condition_type === "UNKNOWN"
);
assert.deepEqual(esUnknown?.msku_aliases.sort(), ["TEST_LEDGER_SELLER_A", "TEST_LEDGER_SELLER_ALIAS"]);
assert.equal(esUnknown?.ending_warehouse_balance, 12, "aliases do not multiply quantity");
assert.equal(canonical.filter((row) => row.asin === "ASIN_TEST_LEDGER" && row.fnsku.startsWith("FNSKU_TEST_")).some((row) => row.fnsku === "FNSKU_TEST_B"), true);
assert.equal(canonical.filter((row) => row.fnsku === "FNSKU_TEST_A" && row.location_raw === "ES").length, 2, "condition is part of grain");
assert.equal(canonical.find((row) => row.location_raw === "ES")?.physical_country, "ES");
assert.equal(canonical.find((row) => row.location_raw === "CZ")?.physical_country, "CZ");
assert.equal(canonical.find((row) => row.location_raw === "MAD6")?.location_type, "FC");
assert.equal(canonical.find((row) => row.location_raw === "MAD6")?.physical_country, null);
assert.equal(canonical.find((row) => row.location_raw === "MXP3")?.location_type, "OTHER");

assert.deepEqual(prepareLedgerRowsAgainstPersisted(canonical, canonical), [], "second write is a no-op");

const identityB = resolveLedgerDocumentIdentity({ text: `${fixture}\n` });
const otherDocument = canonical.map((row) => ({
  ...row,
  document_identity: identityB.documentIdentity,
  manual_document_hash: identityB.manualDocumentHash,
}));
assert.equal(
  prepareLedgerRowsAgainstPersisted(otherDocument, canonical).length,
  canonical.length,
  "different document identity remains independent",
);

assert.throws(
  () => prepareLedgerRowsAgainstPersisted(
    [{ ...canonical[0]!, ending_warehouse_balance: canonical[0]!.ending_warehouse_balance + 1 }],
    canonical,
  ),
  /LEDGER_IDENTITY_CONFLICT.*ending_warehouse_balance/,
);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
