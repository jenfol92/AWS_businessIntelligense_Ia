import test from "node:test";
import assert from "node:assert/strict";
import { simulateSharedFbaPool } from "./simulateSharedFbaPool.ts";

test("physical country stock is not a marketplace sales cap", () => {
  const [day] = simulateSharedFbaPool({
    openingSellable: 730,
    days: [{ date: "2026-08-14", demandByMarketplace: [{ marketplaceId: "IT", units: 150 }] }],
  });
  assert.equal(day.servedUnits, 150);
  assert.equal(day.closingSellable, 580);
});

test("concurrent marketplace demand consumes the same pool", () => {
  const [day] = simulateSharedFbaPool({
    openingSellable: 100,
    days: [{
      date: "2026-08-14",
      demandByMarketplace: [
        { marketplaceId: "DE", units: 60 },
        { marketplaceId: "FR", units: 50 },
      ],
    }],
  });
  assert.equal(day.totalDemand, 110);
  assert.equal(day.servedUnits, 100);
  assert.equal(day.lostSalesUnits, 10);
  assert.equal(day.closingSellable, 0);
});

test("Amazon inbound becoming sellable is added once to the shared pool", () => {
  const [day] = simulateSharedFbaPool({
    openingSellable: 10,
    days: [{
      date: "2026-08-14",
      inboundBecomingSellable: 20,
      demandByMarketplace: [{ marketplaceId: "ES", units: 25 }],
    }],
  });
  assert.equal(day.closingSellable, 5);
});
