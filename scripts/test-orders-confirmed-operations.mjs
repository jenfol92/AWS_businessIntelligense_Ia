import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

const rpcSql = read("sql/migrations/20260721_harden_confirmed_order_operations.sql");
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
  /v_balance_due < CURRENT_DATE THEN 'vencido'[\s\S]*ELSE 'pendiente'/,
);

// logistics_type debe sincronizarse en TODOS los pagos no realizados (igual que
// syncSupplierPaymentsForOrder, que fija el mismo valor en DEPOSITO_30 y BALANCE_70),
// mientras que due_date/status siguen limitados a BALANCE_70.
const dueDateUpdate = paymentBlock.match(
  /UPDATE public\.finance_supplier_payments fsp\s+SET\s+due_date[\s\S]*?status IN \('pendiente', 'vencido'\);/,
)?.[0] ?? "";
assert.ok(dueDateUpdate, "debe existir el UPDATE de due_date/status");
assert.match(dueDateUpdate, /payment_type = 'BALANCE_70'/);
assert.doesNotMatch(dueDateUpdate, /logistics_type/);

const logisticsUpdate = paymentBlock.match(
  /IF v_changed_shipping THEN\s+UPDATE public\.finance_supplier_payments fsp\s+SET\s+logistics_type[\s\S]*?status IN \('pendiente', 'vencido'\);/,
)?.[0] ?? "";
assert.ok(logisticsUpdate, "debe existir el UPDATE de logistics_type");
assert.doesNotMatch(
  logisticsUpdate,
  /payment_type = 'BALANCE_70'/,
  "logistics_type debe actualizarse en DEPOSITO_30 y BALANCE_70, no solo en BALANCE_70",
);

// agente_id inválido debe rechazarse con un mensaje entendible (no un error crudo de cast).
assert.match(rpcSql, /agente_id debe ser un UUID válido/);
assert.match(
  rpcSql,
  /agente_id[\s\S]{0,200}!~\*\s*\n?\s*'\^\[0-9a-f\]\{8\}/,
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

// GET sin versión explícita y sin ninguna versión persistida debe renderizar el
// estado actual (comportamiento aceptado: ConfirmOrderModal abre esta misma ruta
// antes de que exista ninguna versión guardada).
const getHandler = proformaRoute.slice(
  proformaRoute.indexOf("export async function GET"),
  proformaRoute.indexOf("export async function POST"),
);
assert.match(getHandler, /return renderCurrentProforma\(req, \{ params \}\);/);
assert.match(
  getHandler,
  /if \(requestedVersion\) \{[\s\S]*?La versión solicitada no existe/,
  "una versión explícita inexistente debe seguir devolviendo error",
);

// El coste comercial debe tener fallback también para órdenes EUR antiguas sin
// coste_unitario_moneda (no solo USD); GBP/CNY no tuvieron nunca columna propia.
assert.match(proformaRoute, /unitEurStored/);
assert.match(
  proformaRoute,
  /moneda === "EUR"\) unitMoneda = unitEurStored/,
);

// El REVOKE de la RPC comercial antigua no debe fallar si la función no existe
// en el entorno (bases que no aplicaron 20260720 todavía).
assert.match(cleanupSql, /DO \$\$/);
assert.match(cleanupSql, /IF EXISTS \(/);
assert.match(cleanupSql, /FROM pg_proc/);

console.log("confirmed operations and proforma assertions: ok");
