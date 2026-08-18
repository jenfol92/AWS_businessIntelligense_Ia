import test from "node:test";
import assert from "node:assert/strict";
import { inboundQuantityQuality, normalizeAmazonInboundStatus, resolveInboundEtaEvidence } from "./amazonInboundCanonical.ts";

test("only demonstrated Amazon inbound statuses are normalized",()=>{
  assert.equal(normalizeAmazonInboundStatus("WORKING"),"PLANNED");
  assert.equal(normalizeAmazonInboundStatus("READY_TO_SHIP"),"READY_TO_SHIP");
  assert.equal(normalizeAmazonInboundStatus("DELETED"),"CANCELLED");
  assert.equal(normalizeAmazonInboundStatus("MADE_UP"),"UNKNOWN");
});
test("ETA precedence never invents a date",()=>{
  assert.equal(resolveInboundEtaEvidence({amazonExplicit:"2026-08-20",carrierExplicit:"2026-08-21",erpEstimated:"2026-08-22"}).etaSource,"AMAZON_EXPLICIT");
  assert.equal(resolveInboundEtaEvidence({carrierExplicit:"2026-08-21",erpEstimated:"2026-08-22"}).etaSource,"CARRIER_EXPLICIT");
  assert.deepEqual(resolveInboundEtaEvidence({}),{etaDate:null,etaSource:"UNAVAILABLE",confidence:"UNAVAILABLE"});
});
test("over-receipt is preserved and flagged",()=>assert.deepEqual(inboundQuantityQuality(10,12),{expected:10,received:12,overReceived:true,difference:2}));
