import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../../../sql/migrations/20260810_02_harden_reopen_confirmed_order_finance.sql", import.meta.url),
  "utf8",
);

test("pending deposit and balance are removed atomically before reopening", () => {
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /FOR UPDATE;/);
  assert.match(migration, /DELETE FROM public\.finance_supplier_payments[\s\S]*payment_type IN \('DEPOSITO_30', 'BALANCE_70'\)/);
  assert.ok(migration.indexOf("DELETE FROM public.finance_supplier_payments") < migration.indexOf("UPDATE public.ordenes_compra"));
  assert.match(migration, /estado = 'borrador'/);
  assert.match(migration, /fecha_confirmacion = NULL/);
  assert.match(migration, /COMMIT;/);
});

test("reconfirmation cannot collide with orphaned canonical obligations", () => {
  assert.match(migration, /ORDER_REOPEN_FINANCE_CLEANUP_INCOMPLETE/);
  assert.match(migration, /payment\.payment_type IN \('DEPOSITO_30', 'BALANCE_70'\)/g);
});

for (const [caseName, guard] of [
  ["paid deposit", /status NOT IN \('pendiente', 'vencido'\)/],
  ["partial deposit", /status NOT IN \('pendiente', 'vencido'\)/],
  ["paid balance", /status NOT IN \('pendiente', 'vencido'\)/],
  ["recorded paid amount", /actual_amount_original IS NOT NULL[\s\S]*actual_amount_eur IS NOT NULL/],
  ["existing allocation", /finance_purchase_payment_allocations/],
  ["existing execution", /finance_supplier_payment_executions/],
]) {
  test(`${caseName} blocks reopening with obligation identity`, () => {
    assert.match(migration, guard);
    assert.match(migration, /ORDER_REOPEN_BLOCKED_BY_SUPPLIER_PAYMENT: obligation_id=% payment_type=% status=%/);
  });
}

test("unauthorized users are denied without direct table grants", () => {
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = public, pg_temp/);
  assert.match(migration, /finance_can_manage_unlinked_obligations\(\)/);
  assert.match(migration, /ADMIN_OR_ACCOUNTING_REQUIRED/);
  assert.doesNotMatch(migration, /GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)[\s\S]*finance_supplier_payments/i);
});

test("any intermediate exception rolls back the complete RPC statement", () => {
  assert.ok(migration.indexOf("ORDER_REOPEN_FINANCE_CLEANUP_INCOMPLETE") < migration.indexOf("UPDATE public.ordenes_compra"));
  assert.match(migration, /LANGUAGE plpgsql[\s\S]*SECURITY DEFINER/);
  assert.doesNotMatch(migration, /EXCEPTION\s+WHEN/);
});
