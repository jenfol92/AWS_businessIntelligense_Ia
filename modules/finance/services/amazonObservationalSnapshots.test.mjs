import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("observational snapshot migration is idempotent and cannot create RECEIVED or cash", async () => {
  const sql = await readFile(new URL("../../../sql/migrations/20260812_01_amazon_treasury_observational_snapshots.sql", import.meta.url), "utf8");
  assert.match(sql, /observation_key/);
  assert.match(sql, /on conflict \(observation_key\)/);
  assert.match(sql, /OBSERVATIONAL_SNAPSHOT_CANNOT_CREATE_RECEIVED/);
  assert.match(sql, /alter column forecast_id drop not null/);
  assert.doesNotMatch(sql, /finance_receive_amazon_income|insert into public\.finance_cash_movements|update public\.finance_cash_accounts/i);
});
