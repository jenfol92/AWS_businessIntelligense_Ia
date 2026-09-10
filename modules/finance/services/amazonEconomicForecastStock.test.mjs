import assert from "node:assert/strict";
import test from "node:test";
import { allocateOperationalFbaStock,resolveStockFreshness } from "./operationalFbaStockAllocation.ts";

test("reparte PAN EU por demanda sin duplicar el stock y separa UK",()=>{
  const now=new Date("2026-09-02T12:00:00Z");
  const stocks=new Map([["p1",{producto_id:"p1",stock_fba_pan_eu:300,stock_fba_uk:80,stock_fba_total:380,observed_at:"2026-09-02T08:00:00Z",dual_pool_complete:true}]]);
  const result=allocateOperationalFbaStock([
    {productId:"p1",marketplace:"ES",fulfillmentChannel:"FBA",demandUnits:200},
    {productId:"p1",marketplace:"DE",fulfillmentChannel:"FBA",demandUnits:100},
    {productId:"p1",marketplace:"GB",fulfillmentChannel:"FBA",demandUnits:50},
  ],stocks,now);
  assert.equal(result[0].stockValue,200);
  assert.equal(result[1].stockValue,100);
  assert.equal(result[2].stockValue,80);
  assert.equal(result.reduce((sum,row)=>sum+(row.stockValue??0),0),380);
  assert.ok(result.every(row=>row.stockFreshness==="FRESH"));
});

test("stock antiguo no limita silenciosamente el forecast",()=>{
  assert.equal(resolveStockFreshness("2026-08-30T00:00:00Z",new Date("2026-09-02T12:00:00Z"),48),"STALE");
});
