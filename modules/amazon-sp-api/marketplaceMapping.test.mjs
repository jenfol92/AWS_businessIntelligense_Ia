import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalSalesMarketplaceScope,
  observedValidSalesMarketplaceId,
  resolveFbaSaleCountry,
  salesChannelToMarketplaceId,
  salesChannelToMarketplaceCountry,
} from "./marketplaceMapping.ts";

test("maps canonical Amazon sales channels to marketplace countries", () => {
  assert.equal(salesChannelToMarketplaceCountry("amazon.es"), "ES");
  assert.equal(salesChannelToMarketplaceCountry(" AMAZON.CO.UK "), "GB");
  assert.equal(salesChannelToMarketplaceCountry("unknown"), null);
  assert.equal(salesChannelToMarketplaceId("amazon.fr"), "A13V1IB3VIYZZH");
  assert.equal(salesChannelToMarketplaceId("amazon.nl"), "A1805IZSGTT6HS");
  assert.equal(salesChannelToMarketplaceId("amazon.ie"), "A28R8C7NBKEWEA");
  assert.equal(salesChannelToMarketplaceId("amazon.com.be"), "AMEN7PMS3EDWL");
  assert.equal(salesChannelToMarketplaceId("amazon.ae"), "A2VIGQ35RCS4UG");
  assert.equal(salesChannelToMarketplaceId("amazon.sa"), "A17E79C6D8DWNP");
  assert.equal(salesChannelToMarketplaceId("unknown"), null);
});

test("derives observed scope only from valid report rows without requiring a product match", () => {
  const validRow = {
    saleDate: "2026-08-31",
    sku: "SELLER-SKU",
    quantity: 1,
    salesChannel: "amazon.sa",
  };

  assert.equal(observedValidSalesMarketplaceId(validRow), "A17E79C6D8DWNP");
  assert.equal(observedValidSalesMarketplaceId({ ...validRow, saleDate: null }), null);
  assert.equal(observedValidSalesMarketplaceId({ ...validRow, sku: "" }), null);
  assert.equal(observedValidSalesMarketplaceId({ ...validRow, quantity: 0 }), null);
  assert.equal(observedValidSalesMarketplaceId({ ...validRow, salesChannel: "unknown" }), null);
});

test("unions requested and observed sales marketplaces deterministically", () => {
  const requested = [
    "A1RKKUPIHCS9HS",
    "A13V1IB3VIYZZH",
    "A1PA6795UKMFR9",
    "APJ6JRA9NG5V4",
    "A1F83G8C2ARO7P",
    "A1C3SOZRARQ6R3",
    "A2NODRKZP88ZB9",
  ];
  const observed = [
    "A1RKKUPIHCS9HS",
    "A13V1IB3VIYZZH",
    "A1PA6795UKMFR9",
    "APJ6JRA9NG5V4",
    "A1F83G8C2ARO7P",
    "A2NODRKZP88ZB9",
    "A1805IZSGTT6HS",
    "A28R8C7NBKEWEA",
    "AMEN7PMS3EDWL",
    "A2VIGQ35RCS4UG",
    "A17E79C6D8DWNP",
  ];
  const expected = [...new Set([...requested, ...observed])].sort();

  assert.deepEqual(buildCanonicalSalesMarketplaceScope(requested, observed), expected);
  assert.deepEqual(buildCanonicalSalesMarketplaceScope(requested, observed), expected);
});

test("unknown sales channels do not enter canonical marketplace scope", () => {
  const unknownMarketplaceId = salesChannelToMarketplaceId("unknown");
  assert.equal(unknownMarketplaceId, null);
  assert.deepEqual(
    buildCanonicalSalesMarketplaceScope([], unknownMarketplaceId ? [unknownMarketplaceId] : []),
    [],
  );
});

test("keeps a valid delivery country and replaces Amazon -- with marketplace country", () => {
  assert.equal(resolveFbaSaleCountry({ shipCountry: "fr", salesChannel: "amazon.de" }), "FR");
  assert.equal(resolveFbaSaleCountry({ shipCountry: "--", salesChannel: "amazon.it" }), "IT");
  assert.equal(resolveFbaSaleCountry({ shipCountry: "", salesChannel: "amazon.ie" }), "IE");
  assert.equal(resolveFbaSaleCountry({ shipCountry: "--", salesChannel: "unknown" }), null);
});

test("preserves the raw territory as evidence but classifies unsupported FK countries as UNKNOWN", () => {
  const supportedCountries = new Set(["ES", "GB", "UNKNOWN"]);
  assert.equal(resolveFbaSaleCountry({ shipCountry: "GG", salesChannel: "amazon.co.uk", supportedCountries }), "UNKNOWN");
  assert.equal(resolveFbaSaleCountry({ shipCountry: "ES", salesChannel: "amazon.es", supportedCountries }), "ES");
});
