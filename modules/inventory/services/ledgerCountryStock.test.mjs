import assert from "node:assert/strict";
import test from "node:test";
import { aggregateLatestLedgerByCountry } from "./ledgerCountryStock.ts";

test("stock por país replica Seller Central: dedupe, Grade & Resell y tránsito separados", () => {
const P="p1", d="2026-09-27";
const r=(fnsku,sku,loc,bal,extra={})=>({producto_id:P,sku_original:sku,fnsku,asin:"B0GRVMPNXX",snapshot_date:d,disposition:"SELLABLE",condition_type:"NEWITEM",ending_warehouse_balance:bal,location:loc,updated_at:"2026-09-28T01:00:00Z",...extra});
const rows=[
 r("X002OZHZ7N","amzn.gr.f8436616610425-2JT0","PL",1), r("X002O98JIN","amzn.gr.f8436616610425-kF90","GB",1),
 r("B0GRVMPNXX","f8436616610425","PL",15), r("B0GRVMPNXX","f8436616610425","IT",9),
 r("B0GRVMPNXX","f8436616610425","GB",167), r("B0GRVMPNXX","f8436616610425","FR",12),
 r("B0GRVMPNXX","f8436616610425","ES",75), r("B0GRVMPNXX","f8436616610425","DE",264,{in_transit_between_warehouses:90}),
 // duplicado de otra fuente (más antiguo) y día anterior: no deben sumar
 r("B0GRVMPNXX","f8436616610425","DE",264,{updated_at:"2026-09-27T01:00:00Z",in_transit_between_warehouses:90}),
 r("B0GRVMPNXX","f8436616610425","DE",300,{snapshot_date:"2026-09-26"}),
];
const out=Object.fromEntries(aggregateLatestLedgerByCountry(rows,"2026-09-28").get(P).map(x=>[x.pais,[x.stockSellable,x.stockResaleSellable,x.stockInTransit]]));

assert.deepEqual(out,{DE:[264,0,90],ES:[75,0,0],FR:[12,0,0],GB:[167,1,0],IT:[9,0,0],PL:[15,1,0]});
});
