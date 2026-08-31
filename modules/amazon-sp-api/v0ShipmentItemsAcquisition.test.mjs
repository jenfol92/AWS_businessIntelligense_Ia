import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SpApiError } from "./errors.ts";
import {
  V0_SHIPMENT_ITEMS_DELAY_MS,
  V0_SHIPMENT_ITEMS_RATE_LIMIT_REFERENCE,
  createV0ShipmentItemsAcquisitionState,
  fetchV0ShipmentItemsSequential,
} from "./v0ShipmentItemsAcquisition.ts";

function rateLimitError(retryAfter = "2") {
  return new SpApiError("QuotaExceeded", "rate_limited", 429, {
    errors: [{ code: "QuotaExceeded", message: "You exceeded your quota" }],
    headers: { "retry-after": retryAfter },
    requestId: "req-429",
    operation: "GET /fba/inbound/v0/shipments/FBA_TEST/items",
    method: "GET",
    path: "/fba/inbound/v0/shipments/FBA_TEST/items",
  });
}

test("V0 rate limit reference documents getShipmentItemsByShipmentId 2 rps burst 30", () => {
  assert.match(V0_SHIPMENT_ITEMS_RATE_LIMIT_REFERENCE, /getShipmentItemsByShipmentId/i);
  assert.match(V0_SHIPMENT_ITEMS_RATE_LIMIT_REFERENCE, /2 requests\/second/i);
  assert.match(V0_SHIPMENT_ITEMS_RATE_LIMIT_REFERENCE, /burst 30/i);
  assert.strictEqual(V0_SHIPMENT_ITEMS_DELAY_MS, 600);
});

test("SHIPMENT_ITEMS_SEQUENTIAL: no Promise.all for v0 shipment items", async () => {
  const diagSource = await readFile(
    "modules/amazon-sp-api/inboundShipmentsDiagnosticService.ts",
    "utf8",
  );
  assert.match(
    diagSource,
    /fetchV0ShipmentItemsSequential/,
    "parseRawShipments debe usar fetch secuencial",
  );
  assert.doesNotMatch(
    diagSource,
    /parseRawShipments[\s\S]{0,400}Promise\.all/s,
    "parseRawShipments no debe paralelizar shipment items",
  );
});

test("SHIPMENT_ITEMS_THROTTLE: espera fija entre llamadas exitosas", async () => {
  const sleeps = [];
  const state = createV0ShipmentItemsAcquisitionState();
  const calls = [];

  await fetchV0ShipmentItemsSequential({
    shipmentIds: ["A", "B", "C"],
    state,
    delayMs: 123,
    sleepFn: async (ms) => {
      sleeps.push(ms);
    },
    fetchItems: async (shipmentId) => {
      calls.push(shipmentId);
      return [{ id: shipmentId }];
    },
  });

  assert.deepStrictEqual(calls, ["A", "B", "C"]);
  assert.deepStrictEqual(sleeps, [123, 123]);
});

test("429_STOPS_FURTHER_ITEM_CALLS: detiene llamadas posteriores", async () => {
  const state = createV0ShipmentItemsAcquisitionState();
  const calls = [];

  await fetchV0ShipmentItemsSequential({
    shipmentIds: ["A", "B", "C", "D"],
    state,
    delayMs: 0,
    sleepFn: async () => {},
    fetchItems: async (shipmentId) => {
      calls.push(shipmentId);
      if (shipmentId === "B") throw rateLimitError();
      return [{ id: shipmentId }];
    },
  });

  assert.deepStrictEqual(calls, ["A", "B"]);
  assert.strictEqual(state.rateLimited, true);
  assert.strictEqual(state.itemsFetched, 1);
  assert.strictEqual(state.itemsSkippedAfterRateLimit, 3);
});

test("PARTIAL_ON_429: acquisition queda incomplete", async () => {
  const state = createV0ShipmentItemsAcquisitionState();
  await fetchV0ShipmentItemsSequential({
    shipmentIds: ["A", "B"],
    state,
    delayMs: 0,
    sleepFn: async () => {},
    fetchItems: async (shipmentId) => {
      if (shipmentId === "B") throw rateLimitError("5");
      return [{ id: shipmentId }];
    },
  });

  assert.strictEqual(state.acquisitionComplete, false);
  assert.strictEqual(state.retryAfter, "5");
});

test("429 preserves already acquired items", async () => {
  const state = createV0ShipmentItemsAcquisitionState();
  const result = await fetchV0ShipmentItemsSequential({
    shipmentIds: ["A", "B", "C"],
    state,
    delayMs: 0,
    sleepFn: async () => {},
    fetchItems: async (shipmentId) => {
      if (shipmentId === "B") throw rateLimitError();
      return [{ sku: shipmentId }];
    },
  });

  assert.deepStrictEqual(result.get("A"), [{ sku: "A" }]);
  assert.deepStrictEqual(result.get("B"), []);
  assert.deepStrictEqual(result.get("C"), []);
});

test("NON_DESTRUCTIVE_ON_429: sync no borra en rate limit", async () => {
  const syncSource = await readFile(
    "modules/amazon-sp-api/syncInboundShipmentsToAmazonEnviosService.ts",
    "utf8",
  );
  assert.doesNotMatch(
    syncSource,
    /await cleanupUnlinkedAmazonEnviosIfSafe\(\)/,
    "sync no debe ejecutar cleanup destructivo",
  );
  assert.match(
    syncSource,
    /acquisitionComplete:\s*diagnostic\.discovery\?\.discoveryComplete/,
    "acquisitionComplete refleja discovery parcial",
  );
});

test("discoveryComplete depende de shipmentItemsAcquisitionComplete", async () => {
  const diagSource = await readFile(
    "modules/amazon-sp-api/inboundShipmentsDiagnosticService.ts",
    "utf8",
  );
  assert.match(
    diagSource,
    /shipmentItemsAcquisitionComplete/,
    "v0Complete debe incluir shipment items acquisition",
  );
});
