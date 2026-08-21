import test from "node:test";
import assert from "node:assert/strict";

import { buildOperationalPoolInventoryModel } from "./operationalInventoryPools.ts";

const productId = "614e8e63-b23a-4c4f-8915-abf19a86702f";
const asin = "B0DJBQGKBT";
const observation = (operationalPool, sellerSku, fnSku, fulfillableQuantity, extra = {}) => ({
  productoId: productId,
  operationalPool,
  sellerSku,
  asin,
  fnSku,
  fulfillableQuantity,
  reservedQuantity: extra.reservedQuantity ?? 0,
  inboundWorkingQuantity: extra.inboundWorkingQuantity ?? 0,
  inboundShippedQuantity: extra.inboundShippedQuantity ?? 0,
  inboundReceivingQuantity: extra.inboundReceivingQuantity ?? 0,
  unfulfillableQuantity: extra.unfulfillableQuantity ?? 0,
  researchingQuantity: extra.researchingQuantity ?? 0,
  totalQuantity: extra.totalQuantity ?? fulfillableQuantity,
  raw: extra.raw ?? {},
});

test("same FNSKU and pool deduplicates multiple Seller SKU aliases", () => {
  const model = buildOperationalPoolInventoryModel({
    observations: [
      observation("UK", "uk-alias-a", "B0DJBQGKBT", 220),
      observation("UK", "uk-alias-b", "B0DJBQGKBT", 220),
    ],
    completePools: { PAN_EU: true, UK: true },
  });
  assert.equal(model.contributors.length, 1);
  assert.deepEqual(model.contributors[0].sellerSkus, ["uk-alias-a", "uk-alias-b"]);
  assert.equal(model.products[0].stockFbaUk, 220);
});

test("same physical FNSKU across PAN_EU and UK remains two pool observations", () => {
  const model = buildOperationalPoolInventoryModel({
    observations: [
      observation("PAN_EU", "es-alias", "B0DJBQGKBT", 644),
      observation("UK", "uk-alias", "B0DJBQGKBT", 220),
    ],
    completePools: { PAN_EU: true, UK: true },
  });
  assert.equal(model.contributors.length, 2);
  assert.equal(model.products[0].stockFbaPanEu, 644);
  assert.equal(model.products[0].stockFbaUk, 220);
  assert.equal(model.products[0].stockFbaTotal, 864);
});

test("ALAIA fixture yields PAN_EU 694 plus UK 318 without losing provenance", () => {
  const model = buildOperationalPoolInventoryModel({
    observations: [
      observation("PAN_EU", "Amazon.Found.B0DJBQGKBT", "B0DJBQGKBT", 644),
      observation("PAN_EU", "f8436616610104", "X00259GEWP", 50),
      observation("UK", "Amazon.Found.B0DJBQGKBT", "B0DJBQGKBT", 220),
      observation("UK", "uk-second-alias-same-fnsku", "B0DJBQGKBT", 220),
      observation("UK", "f8436616610104", "X00259GEWP", 98),
    ],
    completePools: { PAN_EU: true, UK: true },
  });
  const alaia = model.products[0];
  assert.equal(alaia.stockFbaPanEu, 694);
  assert.equal(alaia.stockFbaUk, 318);
  assert.equal(alaia.stockFbaTotal, 1012);
  assert.equal(alaia.ukContributors.length, 2);
  assert.equal(alaia.ukContributors.find((row) => row.fnSku === "B0DJBQGKBT")?.sellerSkus.length, 2);
});

test("an incomplete pool makes the complete set non-publishable", () => {
  const complete = buildOperationalPoolInventoryModel({
    observations: [observation("PAN_EU", "es", "F1", 10), observation("UK", "uk", "F1", 5)],
    completePools: { PAN_EU: true, UK: true },
  });
  const incomplete = buildOperationalPoolInventoryModel({
    observations: [observation("PAN_EU", "es", "F1", 10)],
    completePools: { PAN_EU: true, UK: false },
  });
  assert.equal(complete.readyForAtomicPublication, true);
  assert.equal(incomplete.readyForAtomicPublication, false);
});

test("PAN_EU incomplete also makes the complete set non-publishable", () => {
  const model = buildOperationalPoolInventoryModel({
    observations: [observation("UK", "uk", "F1", 5)],
    completePools: { PAN_EU: false, UK: true },
  });
  assert.equal(model.readyForAtomicPublication, false);
});

test("a true within-pool FNSKU conflict remains fail-closed", () => {
  const model = buildOperationalPoolInventoryModel({
    observations: [
      observation("PAN_EU", "alias-a", "F1", 10),
      observation("PAN_EU", "alias-b", "F1", 11),
      observation("UK", "uk", "F1", 4),
    ],
    completePools: { PAN_EU: true, UK: true },
  });
  assert.equal(model.conflicts.length, 1);
  assert.equal(model.readyForAtomicPublication, false);
});
