import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("confirmationDate flows from modal to the effective-date confirmation RPC", () => {
  const modal = read("modules/orders/components/ConfirmOrderModal.tsx");
  const route = read("app/api/orders/[id]/confirm/route.ts");
  const repository = read("modules/orders/repositories/orderConfirmRepository.ts");
  const migration = read("sql/migrations/20260810_01_order_confirmation_effective_date.sql");
  const fxMigration = read("sql/migrations/20260811_02_separate_planned_and_actual_fx.sql");

  assert.match(modal, /Fecha de confirmaci/);
  assert.match(modal, /type="date"[\s\S]*value=\{confirmationDate\}/);
  assert.match(modal, /confirmationDate,/);
  assert.match(route, /confirmationDate = body\.confirmationDate\?\.trim\(\)[\s\S]*new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(repository, /"confirm_order_with_planned_fx"/);
  assert.match(repository, /p_confirmation_date: input\.confirmationDate/);
  assert.match(migration, /SET fecha_confirmacion = p_confirmation_date/);
  assert.match(fxMigration, /confirm_order_with_effective_date\(/);
});

test("manual ETD and ETA remain explicit through modal, API and RPC", () => {
  const modal = read("modules/orders/components/ConfirmOrderModal.tsx");
  const route = read("app/api/orders/[id]/confirm/route.ts");
  const repository = read("modules/orders/repositories/orderConfirmRepository.ts");
  const migration = read("sql/migrations/20260810_01_order_confirmation_effective_date.sql");
  const fxMigration = read("sql/migrations/20260811_02_separate_planned_and_actual_fx.sql");

  assert.match(modal, /eta:\s+eta \|\| null/);
  assert.match(modal, /etd:\s+etd \|\| null/);
  assert.doesNotMatch(modal, /eta:\s+eta \|\| suggestedEta/);
  assert.match(modal, /if \(!etdEditedRef\.current\) setEtd\(savedEtd\)/);
  assert.match(modal, /if \(!etaEditedRef\.current\) setEta\(savedEta\)/);
  assert.match(route, /const eta = body\.eta\?\.trim\(\) \|\| null/);
  assert.match(route, /const etd = body\.etd\?\.trim\(\) \|\| null/);
  assert.match(repository, /p_eta: input\.eta/);
  assert.match(repository, /p_etd: input\.etd \?\? null/);
  assert.match(migration, /v_effective_etd := coalesce\([\s\S]*p_etd/);
  assert.match(migration, /v_effective_eta := coalesce\([\s\S]*p_eta/);
  assert.match(migration, /p_order_id, v_effective_eta, v_effective_etd, p_eta_real/);
});

test("empty ETD and ETA are calculated only at the confirmation RPC boundary", () => {
  const modal = read("modules/orders/components/ConfirmOrderModal.tsx");
  const route = read("app/api/orders/[id]/confirm/route.ts");
  const migration = read("sql/migrations/20260810_01_order_confirmation_effective_date.sql");

  assert.match(modal, /setEtd\(savedEtd\)/);
  assert.match(modal, /setEta\(savedEta\)/);
  assert.doesNotMatch(modal, /setEta\(suggestedEta\)/);
  assert.doesNotMatch(route, /El campo eta es obligatorio/);
  assert.match(migration, /v_order\.fecha_orden \+ coalesce\(p_lead_time_produccion, v_order\.lead_time_produccion, 0\)/);
  assert.match(migration, /v_effective_etd \+ coalesce\(p_lead_time_transito, v_order\.lead_time_transito, 0\)/);
});

test("supplier payment dates keep deposit and balance sources separate", () => {
  const dates = read("modules/finance/utils/resolveSupplierPaymentDates.ts");

  assert.match(dates, /resolveDepositDueDate[\s\S]*order\.fecha_confirmacion/);
  assert.match(dates, /logisticsType === "amazon_agl"[\s\S]*amazonInbound\?\.fecha_salida[\s\S]*order\.etd/);
  assert.match(dates, /logisticsType === "propio"[\s\S]*fecha_eta_estimada[\s\S]*order\.eta_real[\s\S]*order\.eta/);
});

test("payment resync preserves obligations with real execution evidence", () => {
  const migration = read("sql/migrations/20260810_01_order_confirmation_effective_date.sql");
  const fxMigration = read("sql/migrations/20260811_02_separate_planned_and_actual_fx.sql");
  const repository = read("modules/finance/repositories/financeSupplierPaymentsRepository.ts");

  assert.match(repository, /sync_supplier_payment_plan_fx_v2/);
  assert.match(fxMigration, /sync_supplier_payment_plan_protected\(/);
  assert.match(migration, /status IN \('pagado', 'parcial'\)/);
  assert.match(migration, /paid_at IS NOT NULL/);
  assert.match(migration, /actual_amount_original IS NOT NULL/);
  assert.match(migration, /finance_purchase_payment_allocations/);
  assert.match(migration, /FOR UPDATE/);
});

test("historical repair remains preview-first and rollback-only", () => {
  const precheck = read("sql/diagnostics/supplier_deposit_confirmation_date_repair_precheck_readonly.sql");
  const repair = read("sql/repairs/20260810_realign_pending_deposit_due_dates_dry_run.sql");

  assert.match(precheck, /BEGIN TRANSACTION READ ONLY;/);
  assert.match(precheck, /due_date IS DISTINCT FROM orders\.fecha_confirmacion/);
  assert.match(precheck, /count\(allocations\.id\) = 0/);
  assert.match(precheck, /ROLLBACK;/);
  assert.match(repair, /NOT EXISTS[\s\S]*finance_purchase_payment_allocations/);
  assert.doesNotMatch(repair, /COMMIT;/);
  assert.match(repair, /ROLLBACK;/);
});
