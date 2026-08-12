import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveFbaSaleCountry,
  salesChannelToMarketplaceId,
  salesChannelToMarketplaceCountry,
} from "./marketplaceMapping.ts";

test("maps canonical Amazon sales channels to marketplace countries", () => {
  assert.equal(salesChannelToMarketplaceCountry("amazon.es"), "ES");
  assert.equal(salesChannelToMarketplaceCountry(" AMAZON.CO.UK "), "GB");
  assert.equal(salesChannelToMarketplaceCountry("unknown"), null);
  assert.equal(salesChannelToMarketplaceId("amazon.fr"), "A13V1IB3VIYZZH");
  assert.equal(salesChannelToMarketplaceId("amazon.ie"), "A28R8C7NBKEWEA");
  assert.equal(salesChannelToMarketplaceId("unknown"), null);
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
