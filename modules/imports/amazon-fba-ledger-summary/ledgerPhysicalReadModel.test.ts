import assert from "node:assert/strict";
import { summarizeLedgerPhysicalRows } from "./ledgerPhysicalReadModel.ts";

const result = summarizeLedgerPhysicalRows([
  { asin: "B0DJBQGKBT", fnsku: "X00259GEWP", sellerSkuAliases: ["f8436616610104"], locationRaw: "DE", disposition: "SELLABLE", conditionType: "NEWITEM", quantity: 84 },
  { asin: "B0DJBQGKBT", fnsku: "B0DJBQGKBT", sellerSkuAliases: ["f8436616610104UK", "Amazon.Found.B0DJBQGKBT"], locationRaw: "DE", disposition: "SELLABLE", conditionType: null, quantity: 624 },
  { asin: "B0DJBQGKBT", fnsku: "X00259GEWP", sellerSkuAliases: ["f8436616610104"], locationRaw: "ES", disposition: "DEFECTIVE", conditionType: "NEWITEM", quantity: 5 },
]);

assert.equal(result.sellable, 708, "SELLABLE incluye toda condition");
assert.equal(result.newSellable, 84);
assert.equal(result.unknownConditionSellable, 624);
assert.equal(result.unsellable, 5);
assert.equal(result.physicalTotal, 713);
assert.equal(result.uniqueFnskuCount, 2, "ALAIA conserva ambos FNSKU");
assert.deepEqual(result.sellerSkuAliases, ["Amazon.Found.B0DJBQGKBT", "f8436616610104", "f8436616610104UK"]);
