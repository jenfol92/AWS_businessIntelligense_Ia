import test from "node:test";
import assert from "node:assert/strict";
import { aggregateOperationalPoolInventory, dedupeMarketplaceSnapshots, classifyInventoryFreshness, toCanonicalAmazonInventory } from "./amazonCanonicalInventory.ts";

const now=new Date("2026-08-13T12:00:00Z");
test("freshness uses explicit 24h and 72h thresholds",()=>{assert.equal(classifyInventoryFreshness("2026-08-12T12:00:00Z",now),"FRESH");assert.equal(classifyInventoryFreshness("2026-08-11T12:00:00Z",now),"AGING");assert.equal(classifyInventoryFreshness("2026-08-09T12:00:00Z",now),"STALE");assert.equal(classifyInventoryFreshness(null,now),"UNKNOWN");});
test("canonical read model is FBA and never reads global stock_total",()=>{const row=toCanonicalAmazonInventory({producto_id:"p",sku_original:"SKU",marketplace_id:"ES",country:"ES",snapshot_at:"2026-08-12T18:00:00Z",fulfillable_quantity:8,reserved_quantity:2,inbound_quantity:3,unfulfillable_quantity:1,researching_quantity:1,source:"spapi",raw:{asin:"A"}},now);assert.equal(row.fulfillmentChannel,"FBA");assert.equal(row.sellable,8);assert.equal(row.total,11);assert.equal(row.reliable,true);assert.equal("stock_total" in row,false);});
test("stale stock is unavailable rather than reliable zero",()=>{const row=toCanonicalAmazonInventory({producto_id:null,sku_original:"SKU",marketplace_id:"FR",country:"FR",snapshot_at:"2026-06-01T00:00:00Z",fulfillable_quantity:9,reserved_quantity:0,inbound_quantity:0,unfulfillable_quantity:0,researching_quantity:0,source:"spapi"},now);assert.equal(row.sellable,9);assert.equal(row.reliable,false);assert.equal(row.confidence,"UNAVAILABLE");});
test("same sku and marketplace snapshot is not double counted",()=>{assert.equal(dedupeMarketplaceSnapshots([{sku:"A",marketplaceId:"ES",n:1},{sku:"A",marketplaceId:"ES",n:2},{sku:"A",marketplaceId:"FR",n:3}]).length,2);});

const quantities = (fulfillableQuantity, inboundShippedQuantity = 0) => ({
  fulfillableQuantity,
  totalReservedQuantity: fulfillableQuantity === 84 ? 5 : 3,
  inboundWorkingQuantity: 0,
  inboundShippedQuantity,
  inboundReceivingQuantity: 0,
  totalUnfulfillableQuantity: fulfillableQuantity === 84 ? 5 : 0,
  totalResearchingQuantity: 0,
  totalQuantity: fulfillableQuantity + (fulfillableQuantity === 84 ? 10 : 3) + inboundShippedQuantity,
});

test("ALAIA aggregates unique FNSKUs and preserves duplicate Seller SKU aliases",()=>{
  const rows = [
    {marketplace:"ES",asin:"B0DJBQGKBT",sellerSku:"f8436616610104",fnSku:"X00259GEWP",quantities:quantities(84),lastUpdatedTime:"2026-08-13T10:00:00Z"},
    {marketplace:"ES",asin:"B0DJBQGKBT",sellerSku:"f8436616610104UK",fnSku:"B0DJBQGKBT",quantities:quantities(624,669),lastUpdatedTime:"2026-08-13T10:00:00Z"},
    {marketplace:"ES",asin:"B0DJBQGKBT",sellerSku:"Amazon.Found.B0DJBQGKBT",fnSku:"B0DJBQGKBT",quantities:quantities(624,669),lastUpdatedTime:"2026-08-13T10:00:00Z"},
  ];
  const result=aggregateOperationalPoolInventory("B0DJBQGKBT","EU",rows);
  assert.equal(result.available,708);
  assert.equal(result.reserved,8);
  assert.equal(result.inbound.total,669);
  assert.equal(result.uniqueFnskuCount,2);
  assert.deepEqual(result.sellerSkuAliases,["Amazon.Found.B0DJBQGKBT","f8436616610104","f8436616610104UK"]);
});

test("equivalent marketplace observations do not create a marketplace quantity dimension",()=>{
  const signature=quantities(624,669);
  const rows=["ES","DE"].map(marketplace=>({marketplace,asin:"B0DJBQGKBT",sellerSku:"f8436616610104UK",fnSku:"B0DJBQGKBT",quantities:signature,lastUpdatedTime:"2026-08-13T10:00:00Z"}));
  const result=aggregateOperationalPoolInventory("B0DJBQGKBT","EU",rows);
  assert.equal(result.available,624);
  assert.equal(result.inbound.total,669);
  assert.equal(result.uniqueFnskuCount,1);
});
