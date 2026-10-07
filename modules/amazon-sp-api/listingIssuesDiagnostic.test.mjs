import test from "node:test";
import assert from "node:assert/strict";
import { diagnoseProductListingIssues } from "./listingIssuesDiagnostic.ts";

const productoId = "00000000-0000-0000-0000-000000000001";
const relation = { producto_id: productoId, marketplace_id: "MARKETDE", external_sku: "seller-exact", external_asin: "B000000001" };
async function run(overrides = {}) {
  let calls = 0;
  const reads = [];
  const rows = { productos: { id: productoId, sku: "erp-sku", asin: "B000000002" },
    amazon_marketplaces: { id: "MARKETDE", code: "DE", pais_id: "country" }, paises: { id: "country", code: "DE" },
    amazon_fba_inventory_ledger_daily: [{ sku_original: "alias", msku_aliases: ["alias"], asin: "B000000003" }],
    ...overrides.rows };
  const db = { from(table) {
    reads.push(table);
    const query = {
      select() { return query; }, eq() { return query; }, order() { return query; },
      maybeSingle: async () => ({ data: rows[table], error: null }),
      limit: async (n) => { assert.equal(n, 51); return { data: rows[table], error: overrides.ledgerError ?? null }; },
    }; // Deliberately no insert/update/upsert/delete/rpc methods.
    return query;
  } };
  const result = await diagnoseProductListingIssues({ productoId, marketplaceId: "MARKETDE", ...overrides.input }, {
    db, loadProductMarketplaces: async () => overrides.relations ?? [relation],
    observe: async (input) => {
      calls++;
      assert.equal(input.sellerSku, "seller-exact");
      assert.equal(input.marketplaceId, "MARKETDE");
      assert.equal(input.oneShot, true);
      assert.ok(input.signal instanceof AbortSignal);
      return { status: "SUCCESS", issues: [], sku: input.sellerSku, marketplaceId: input.marketplaceId };
    },
  });
  return { result, calls, reads };
}

test("read-only diagnostic uses relationship SKU and country FK; reports discrepancies without repairs", async () => {
  const { result, calls } = await run();
  assert.equal(calls, 1);
  assert.equal(result.product.sku, "seller-exact");
  assert.equal(result.product.erpSku, "erp-sku");
  assert.equal(result.product.asin, relation.external_asin);
  assert.equal(result.asinVerifiedByAmazon, false);
  assert.equal(result.marketplace.country, "DE");
  assert.deepEqual(result.warnings, ["ERP_SKU_DIFFERS_FROM_EXTERNAL_SKU", "ERP_ASIN_DIFFERS_FROM_EXTERNAL_ASIN",
    "LEDGER_ASIN_DISCREPANCY", "EXTERNAL_SKU_NOT_IN_LEDGER_SAMPLE"]);
});

for (const [name, options, expected] of [
  ["unknown marketplace", { rows: { amazon_marketplaces: null } }, "MARKETPLACE_UNKNOWN"],
  ["unassigned marketplace", { input: { marketplaceId: "OTHER" } }, "PRODUCT_MARKETPLACE_NOT_ASSIGNED"],
  ["missing SKU", { relations: [{ ...relation, external_sku: null }] }, "EXTERNAL_SKU_MISSING"],
  ["whitespace SKU", { relations: [{ ...relation, external_sku: " seller-exact" }] }, "EXTERNAL_SKU_INVALID"],
  ["ambiguous relationship", { relations: [relation, relation] }, "PRODUCT_MARKETPLACE_IDENTITY_AMBIGUOUS"],
  ["missing country", { rows: { paises: null } }, "MARKETPLACE_COUNTRY_MISSING"],
  ["missing product", { rows: { productos: null } }, "PRODUCT_NOT_FOUND"],
  ["invalid product id", { input: { productoId: "bad" } }, "INVALID_DIAGNOSTIC_PARAMETERS"],
]) test(`${name}: explicit error, no fallback and zero Amazon calls`, async () => {
  const { result, calls } = await run(options);
  assert.equal(result.error, expected);
  assert.equal(calls, 0);
});

test("ledger unavailability is explicit and never replaces relationship identity", async () => {
  const { result } = await run({ ledgerError: { message: "unavailable" }, rows: { amazon_fba_inventory_ledger_daily: null } });
  assert.ok(result.warnings.includes("LEDGER_EVIDENCE_UNAVAILABLE"));
  assert.equal(result.ledgerEvidence.complete, false);
});
