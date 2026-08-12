import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../../sql/migrations/20260805_01_supplier_payment_financing_actuals.sql",
  import.meta.url,
);

async function migrationSource() {
  return readFile(migrationUrl, "utf8");
}

test("supplier-payment financing migration replaces only the canonical impl", async () => {
  const source = await migrationSource();

  assert.equal(
    (source.match(/CREATE OR REPLACE FUNCTION public\.finance_finance_supplier_payment_phase1a_impl\(/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(
    source,
    /CREATE OR REPLACE FUNCTION public\.finance_finance_supplier_payment\s*\(/,
  );
  assert.match(
    source,
    /finance_finance_supplier_payment_phase1a_impl\(\s*p_supplier_payment_id uuid,\s*p_source_type text,\s*p_movement_date date,\s*p_cash_account_id uuid DEFAULT NULL,\s*p_credit_line_id uuid DEFAULT NULL,\s*p_notes text DEFAULT NULL,\s*p_idempotency_key text DEFAULT NULL\s*\)\s*RETURNS jsonb/s,
  );
  assert.match(source, /LANGUAGE plpgsql\s+SECURITY INVOKER\s+SET search_path = public, pg_temp/s);
  assert.doesNotMatch(source, /SECURITY DEFINER/);
  assert.match(
    source,
    /ALTER FUNCTION public\.finance_finance_supplier_payment_phase1a_impl\(uuid,text,date,uuid,uuid,text,text\)\s+OWNER TO postgres/,
  );
  assert.match(
    source,
    /REVOKE EXECUTE ON FUNCTION public\.finance_finance_supplier_payment_phase1a_impl\(uuid,text,date,uuid,uuid,text,text\)\s+FROM PUBLIC, anon, authenticated, service_role/,
  );
  assert.doesNotMatch(source, /GRANT EXECUTE/);
});

test("supplier-payment financing migration fixes actual columns and amount contract", async () => {
  const source = await migrationSource();

  for (const [column, type] of [
    ["actual_amount_eur", "numeric\\(14, 2\\)"],
    ["actual_amount_original", "numeric\\(14, 4\\)"],
    ["bank_fee_eur", "numeric"],
    ["ff_fee_eur", "numeric\\(14, 2\\)"],
  ]) {
    assert.match(
      source,
      new RegExp(`ADD COLUMN IF NOT EXISTS ${column} ${type} NULL`),
    );
  }

  assert.match(source, /v_payment\.actual_amount_eur IS NULL/);
  assert.match(source, /v_payment\.actual_amount_eur <= 0/);
  assert.match(source, /v_payment\.actual_amount_eur::text IN \('NaN', 'Infinity', '-Infinity'\)/);
  assert.match(
    source,
    /v_payment_amount_eur := round\(\s*v_payment\.actual_amount_eur\s*\+ COALESCE\(v_payment\.bank_fee_eur, 0\)\s*\+ COALESCE\(v_payment\.ff_fee_eur, 0\),\s*2\s*\)/s,
  );
  assert.match(source, /COALESCE\(v_payment\.bank_fee_eur, 0\) < 0/);
  assert.match(source, /COALESCE\(v_payment\.ff_fee_eur, 0\) < 0/);
  assert.match(source, /abs\(v_payment_amount_eur\) >= 1000000000000/);
  assert.match(source, /p_source_type NOT IN \('cash_account', 'credit_line'\)/);
  assert.doesNotMatch(source, /CREATE UNIQUE INDEX/);
});

test("supplier-payment financing migration preserves locking, atomicity and idempotency", async () => {
  const source = await migrationSource();

  assert.match(source, /^BEGIN;/m);
  assert.match(source, /COMMIT;\s*$/);
  assert.match(
    source,
    /FROM public\.finance_supplier_payments\s+WHERE id = p_supplier_payment_id\s+FOR UPDATE/s,
  );
  assert.match(source, /IF v_payment\.payment_source_type IS NOT NULL THEN/);
  assert.match(source, /'idempotent', true/);
  assert.match(source, /RAISE EXCEPTION 'ALREADY_FINANCED:/);
  assert.match(
    source,
    /public\.finance_create_credit_line_drawdown\([\s\S]*?p_idempotency_key\s*\)/,
  );
  assert.match(source, /NOTIFY pgrst, 'reload schema'/);
});
