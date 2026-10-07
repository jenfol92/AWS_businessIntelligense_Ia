import test from "node:test";
import assert from "node:assert/strict";
import { parseAllOrdersRows, localDateInTimeZone, isCancelledOrderItem } from "./allOrdersReportParser.ts";

const base = {
  "amazon-order-id": "402-1", "merchant-order-id": "", "purchase-date": "2026-09-27T22:30:00+00:00",
  "last-updated-date": "2026-09-28T08:00:00+00:00", "order-status": "Shipped", "fulfillment-channel": "Amazon",
  "sales-channel": "Amazon.es", sku: "f8436616610425", asin: "B0GRVMPNXX", "item-status": "Shipped",
  quantity: "1", currency: "EUR", "item-price": "19.99", "item-tax": "3.47", "shipping-price": "",
  "item-promotion-discount": "", "ship-city": "MADRID", "ship-postal-code": "28001", "ship-country": "ES",
  "is-business-order": "false",
};

test("fecha de compra en hora local del marketplace y sin datos personales", () => {
  const { rows } = parseAllOrdersRows([base], { matchProduct: () => "p1" });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.purchase_date, "2026-09-28"); // 22:30 UTC = 00:30 en Madrid
  assert.equal(r.marketplace_country, "ES");
  assert.equal(r.fulfillment_channel, "FBA");
  assert.equal(r.producto_id, "p1");
  assert.equal(r.item_price, 19.99);
  assert.ok(!("ship_city" in r) && !JSON.stringify(r).includes("28001"));
});

test("FBM, pendiente sin precio y GB en hora de Londres", () => {
  const { rows } = parseAllOrdersRows([
    { ...base, "amazon-order-id": "402-2", "fulfillment-channel": "Merchant", "order-status": "Pending", "item-price": "" },
    { ...base, "amazon-order-id": "202-3", "sales-channel": "Amazon.co.uk", "purchase-date": "2026-09-27T23:30:00+00:00", currency: "GBP" },
  ]);
  assert.equal(rows[0].fulfillment_channel, "FBM");
  assert.equal(rows[0].item_price, null);
  assert.equal(rows[1].marketplace_country, "GB");
  assert.equal(rows[1].purchase_date, "2026-09-28"); // 00:30 BST
  assert.equal(localDateInTimeZone("2026-09-27T22:30:00Z", "Europe/London"), "2026-09-27");
});

test("líneas repetidas del mismo pedido se suman y cancelados se detectan", () => {
  const { rows } = parseAllOrdersRows([base, { ...base, quantity: "2", "item-price": "39.98" }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, 3);
  assert.equal(Math.round(rows[0].item_price * 100), 5997);
  assert.equal(isCancelledOrderItem("Cancelled", ""), true);
  assert.equal(isCancelledOrderItem("Shipped", "Shipped"), false);
});
