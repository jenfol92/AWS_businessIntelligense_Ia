import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../../../sql/migrations/20260915_01_amazon_deferred_observation_fields.sql", import.meta.url);

test("deferred migration drops legacy RPC overloads without cascade", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /^begin;/im);
  assert.match(sql, /commit;/i);
  assert.doesNotMatch(sql, /\bcascade\b/i);
  assert.match(
    sql,
    /drop function if exists public\.finance_insert_amazon_treasury_observation\([\s\S]*p_fx_observed_at timestamp with time zone, p_source text, p_evidence jsonb[\s\S]*\);/i,
  );
  assert.match(
    sql,
    /drop function if exists public\.finance_insert_amazon_treasury_observation\([\s\S]*p_fx_kind text, p_estimated_fx_rate numeric, p_realized_fx_rate numeric, p_realized_amount_eur numeric, p_source text, p_evidence jsonb[\s\S]*\);/i,
  );
  assert.match(sql, /create or replace function public\.finance_insert_amazon_treasury_observation\(/i);
  assert.match(sql, /p_amazon_release_date date/i);
  assert.match(sql, /UTC calendar day from Amazon DeferredContext\.maturityDate/i);
  assert.match(
    sql,
    /grant execute on function public\.finance_insert_amazon_treasury_observation\([\s\S]*\) to service_role;/i,
  );
});
