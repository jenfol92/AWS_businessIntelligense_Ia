import assert from "node:assert/strict";
import { classifyLedgerLocation } from "./ledgerLocationContract.ts";

const countries = new Set(["DE", "ES", "CZ", "SK"]);
const de = classifyLedgerLocation(" DE ", { knownCountryCodes: countries });
assert.equal(de.locationRaw, "DE");
assert.equal(de.locationType, "COUNTRY");
assert.equal(de.physicalCountry, "DE");

const unknownMad6 = classifyLedgerLocation("MAD6");
assert.equal(unknownMad6.locationRaw, "MAD6");
assert.equal(unknownMad6.locationType, "OTHER");
assert.equal(unknownMad6.physicalCountry, null, "MAD6 no se convierte automaticamente a ES");
assert.equal(unknownMad6.diagnosticStatus, "LEDGER_LOCATION_UNCLASSIFIED");

const corroboratedMad6 = classifyLedgerLocation("MAD6", {
  knownCountryCodes: countries,
  fulfillmentCenters: new Set(["MAD6"]),
});
assert.equal(corroboratedMad6.locationRaw, "MAD6");
assert.equal(corroboratedMad6.locationType, "FC");
assert.equal(corroboratedMad6.physicalCountry, null);

const enrichedMad6 = classifyLedgerLocation("MAD6", {
  knownCountryCodes: countries,
  fulfillmentCenters: new Set(["MAD6"]),
  physicalCountryByCenter: new Map([["MAD6", "ES"]]),
  evidenceSourceByCenter: new Map([["MAD6", "INBOUND_DESTINATION"]]),
});
assert.equal(enrichedMad6.locationRaw, "MAD6");
assert.equal(enrichedMad6.locationType, "FC");
assert.equal(enrichedMad6.physicalCountry, "ES");

assert.equal(classifyLedgerLocation("RLG1").locationType, "OTHER");
assert.equal(classifyLedgerLocation("").locationType, "UNKNOWN");
const cz = classifyLedgerLocation("CZ", { knownCountryCodes: countries });
assert.equal(cz.locationType, "COUNTRY");
assert.equal(cz.physicalCountry, "CZ");
const sk = classifyLedgerLocation("SK", { knownCountryCodes: countries });
assert.equal(sk.locationType, "COUNTRY");
assert.equal(sk.physicalCountry, "SK");
