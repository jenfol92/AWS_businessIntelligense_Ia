import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const rpcSql = read("sql/migrations/20260721_fix_confirmed_order_operations.sql");
const versionSql = read("sql/migrations/20260721_safe_order_proforma_versioning.sql");
const cleanupSql = read("sql/migrations/20260721_remove_confirmed_commercial_edit_rpc.sql");
const operationsRoute = read("app/api/orders/[id]/confirmed-operations/route.ts");
const operationsService = read(
  "modules/orders/services/updateConfirmedOrderOperationsService.ts",
);
const proformaRoute = read("app/api/orders/[id]/proforma/route.ts");
const modal = read("modules/orders/components/OrderFormModal.tsx");
const ordersPage = read("app/[locale]/(dashboard)/pedidos/page.tsx");

assert.doesNotMatch(operationsRoute, /\bitems\b|orden_items|producto_costos/);
assert.doesNotMatch(operationsService, /\bitems\b|orden_items|producto_costos/);

const paymentBlock = rpcSql.slice(rpcSql.indexOf("IF v_changed_schedule"));
assert.match(
  paymentBlock,
  /payment_type = 'BALANCE_70'[\s\S]*status IN \('pendiente', 'vencido'\)/,
);
assert.doesNotMatch(paymentBlock, /DEPOSITO_30|amount_original\s*=|producto_costos/);
assert.match(
  paymentBlock,
  /amazon_agl' THEN v_updated\.etd::date/,
);
assert.match(
  paymentBlock,
  /logistics_type = CASE[\s\S]*WHEN v_changed_shipping/,
);
assert.match(
  paymentBlock,
  /v_balance_due < CURRENT_DATE THEN 'vencido'[\s\S]*ELSE 'pendiente'/,
);

const destinationUpdate = rpcSql.match(
  /UPDATE public\.ordenes_compra oc[\s\S]*?RETURNING \* INTO v_updated;/,
)?.[0] ?? "";
assert.ok(destinationUpdate);
assert.doesNotMatch(destinationUpdate, /orden_items|producto_costos|finance_supplier_payments|order_proforma_versions/);

for (const forbidden of [
  "Exchange Rate to EUR",
  "Unit Price (EUR)",
  "Line Total (EUR)",
  "Equivalent Total EUR",
  "Deposit (EUR)",
  "Balance (EUR)",
  "Exchange rate pending",
]) {
  assert.doesNotMatch(proformaRoute, new RegExp(forbidden.replace(/[()]/g, "\\$&")));
}
for (const removedName of [
  "tipoCambio",
  "sinTipoCambio",
  "showEurCols",
  "eurHeaderCols",
  "eurFootCols",
  "eurTotalBlock",
  "eurPaymentBlock",
  "cambioLabel",
  "avisoCambio",
]) {
  assert.doesNotMatch(proformaRoute, new RegExp(`\\b${removedName}\\b`));
}

const confirmedSave = modal.slice(
  modal.indexOf("if (isConfirmedEdit && initialOrden?.id)"),
  modal.indexOf("const body1 ="),
);
assert.match(confirmedSave, /setSavedOrder\(updatedOrder\)/);
assert.match(confirmedSave, /setSuccessMessage\("Cambios guardados correctamente"\)/);
assert.match(confirmedSave, /onOperationalSaved\?\.\(updatedOrder\)/);
assert.doesNotMatch(confirmedSave, /window\.open|onSaved\(/);
assert.match(
  ordersPage,
  /onOperationalSaved=\{\(orden\) => \{[\s\S]*ordersList\.patchOrder\(/,
);

assert.equal(
  existsSync(join(root, "app/api/orders/[id]/confirmed-edit/route.ts")),
  false,
);
assert.equal(
  existsSync(join(root, "modules/orders/services/updateConfirmedOrderService.ts")),
  false,
);
assert.match(
  cleanupSql,
  /DROP FUNCTION IF EXISTS public\.update_confirmed_purchase_order\(uuid, jsonb, jsonb\)/,
);

assert.match(rpcSql, /lead_time_produccion debe ser un entero mayor o igual que cero/);
assert.match(rpcSql, /lead_time_transito debe ser un entero mayor o igual que cero/);
assert.match(rpcSql, /tipo_cambio_moneda_eur debe ser positivo/);
assert.match(rpcSql, /tipo_envio debe ser propio o amazon_agl/);
assert.match(rpcSql, /La edición operativa contiene campos no permitidos/);

assert.match(
  versionSql,
  /FROM public\.ordenes_compra[\s\S]*FOR UPDATE[\s\S]*max\(opv\.version\)[\s\S]*INSERT INTO public\.order_proforma_versions/,
);
assert.match(
  proformaRoute,
  /\.rpc\(\s*"create_order_proforma_version"/,
);
assert.doesNotMatch(
  proformaRoute,
  /\.from\("order_proforma_versions"\)\s*\.insert/,
);
assert.match(proformaRoute, /select\("id, proforma_firmada_url"\)/);
assert.doesNotMatch(
  `${rpcSql}\n${versionSql}\n${proformaRoute}`,
  /(?:update|set)\s+proforma_firmada_url/i,
);

console.log("confirmed operations and proforma assertions: ok");
