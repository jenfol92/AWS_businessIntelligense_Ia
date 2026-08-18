import test from "node:test";
import assert from "node:assert/strict";
import { buildSharedFbaPools } from "./sharedFbaInventoryPool.ts";

const row = (marketplaceId, sellable = 700) => ({
  productId: "alaia",
  sku: "8436616610104",
  marketplaceId,
  sellable,
  reserved: 8,
  inbound: 12,
  unfulfillable: 2,
  researching: 1,
  sourceTimestamp: "2026-08-13T08:00:00Z",
  freshnessStatus: "FRESH",
});

test("marketplace replicas cannot multiply one shared FBA pool", () => {
  const pools = buildSharedFbaPools(
    [row("DE"), row("FR"), row("IT"), row("ES")],
    [{ poolId: "EU_FBA", marketplaceIds: ["DE", "FR", "IT", "ES"], source: "account evidence", confidence: "HIGH" }],
  );
  assert.equal(pools.length, 1);
  assert.equal(pools[0].uniqueSellable, 700);
  assert.equal(pools[0].unfulfillable, 2);
});

test("GB is not merged into continental EU without evidence", () => {
  const pools = buildSharedFbaPools(
    [row("DE"), row("FR"), row("GB", 300)],
    [{ poolId: "EU_FBA", marketplaceIds: ["DE", "FR"], source: "account evidence", confidence: "HIGH" }],
  );
  assert.equal(pools.find((pool) => pool.poolId === "EU_FBA")?.uniqueSellable, 700);
  assert.equal(pools.find((pool) => pool.poolId === "UNRESOLVED:GB")?.uniqueSellable, null);
});

test("different marketplace quantities are not forced into a unique total", () => {
  const [pool] = buildSharedFbaPools(
    [row("DE", 700), row("FR", 690)],
    [{ poolId: "EU_FBA", marketplaceIds: ["DE", "FR"], source: "account evidence", confidence: "HIGH" }],
  );
  assert.equal(pool.uniqueSellable, null);
  assert.equal(pool.reliable, false);
});

test("stale observations remain last-known and unreliable", () => {
  const stale = { ...row("DE"), freshnessStatus: "STALE" };
  const [pool] = buildSharedFbaPools(
    [stale],
    [{ poolId: "DE_ONLY", marketplaceIds: ["DE"], source: "account evidence", confidence: "HIGH" }],
  );
  assert.equal(pool.uniqueSellable, 700);
  assert.equal(pool.reliable, false);
  assert.equal(pool.confidence, "UNAVAILABLE");
});

