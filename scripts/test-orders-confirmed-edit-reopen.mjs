import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const service = read(
  "modules/orders/services/updateConfirmedOrderOperationsService.ts",
);
const route = read("app/api/orders/[id]/confirmed-operations/route.ts");
const rpcSql = read(
  "sql/migrations/20260721_z_remove_order_fx_from_operational_flow.sql",
);
const proformaSql = read(
  "sql/migrations/20260721_order_proforma_versions.sql",
);
const proformaRoute = read("app/api/orders/[id]/proforma/route.ts");
const modal = read("modules/orders/components/OrderFormModal.tsx");
const reopenService = read("modules/orders/services/reopenOrder.ts");

assert.match(service, /update_confirmed_purchase_order_operations/);
assert.match(service, /p_patch:\s*patch/);
assert.doesNotMatch(service, /p_items|orden_items|producto_costos/);
assert.match(route, /export async function PATCH/);
assert.doesNotMatch(route, /items|coste_unitario/);

assert.match(
  rpcSql,
  /CREATE OR REPLACE FUNCTION public\.update_confirmed_purchase_order_operations/,
);
assert.match(rpcSql, /p_patch jsonb/);
assert.doesNotMatch(rpcSql, /p_items/);
assert.match(rpcSql, /FOR UPDATE/);
assert.match(rpcSql, /v_order\.estado <> 'confirmado'/);
assert.doesNotMatch(rpcSql, /UPDATE public\.orden_items/);
assert.doesNotMatch(rpcSql, /producto_costos/);
assert.doesNotMatch(rpcSql, /order_proforma_versions|proforma_firmada_url/);
assert.doesNotMatch(rpcSql, /status = 'pagado'/);

assert.match(
  rpcSql,
  /key\.name NOT IN \([\s\S]*'destino'[\s\S]*'notas'/,
);
assert.doesNotMatch(rpcSql, /tipo_cambio_moneda_eur|planned_fx_rate|actual_fx_rate/);
assert.doesNotMatch(
  rpcSql,
  /key\.name NOT IN \([\s\S]*'moneda_compra'/,
);
assert.doesNotMatch(
  rpcSql,
  /key\.name NOT IN \([\s\S]*'fob_puerto'/,
);

assert.match(
  rpcSql,
  /payment_type = 'BALANCE_70'\s+AND fsp\.status IN \('pendiente', 'parcial', 'vencido'\)/,
  "ETA/ETD deben recalcular obligaciones no finalizadas",
);
assert.match(
  rpcSql,
  /SET\s+logistics_type = v_updated\.tipo_envio[\s\S]*status IN \('pendiente', 'parcial', 'vencido'\)/,
  "tipo_envio debe actualizar logistics_type sin tocar pagos pagados",
);
assert.doesNotMatch(
  rpcSql,
  /amount_original\s*=/,
  "la edición operativa conserva importes comerciales originales",
);
assert.doesNotMatch(rpcSql, /amount_eur\s*=|coste_total_eur\s*=|orden_items/);
assert.match(rpcSql, /contenedor propio activo/);
assert.match(rpcSql, /envío Amazon inbound activo/);
assert.doesNotMatch(rpcSql, /DELETE FROM public\.contenedor_ordenes/);
assert.doesNotMatch(
  rpcSql,
  /SET status = 'inactive'/,
  "cambiar tipo de envío no debe desvincular asignaciones silenciosamente",
);

assert.match(
  modal,
  /\/confirmed-operations/,
  "guardar confirmada debe usar el endpoint operativo",
);
assert.match(modal, /method:\s*"PATCH"/);
assert.doesNotMatch(
  modal,
  /confirmed-operations[\s\S]{0,800}items:/,
  "el payload operativo no debe enviar líneas",
);
assert.doesNotMatch(modal, /Guardar y generar nueva proforma/);
assert.match(modal, /Cambios guardados correctamente/);
assert.match(modal, /setSavedOrder\(updatedOrder\)/);
assert.doesNotMatch(
  modal,
  /handleSave[\s\S]{0,2600}window\.open\(`\/api\/orders\/\$\{initialOrden\.id\}\/proforma`/,
  "guardar cambios no debe abrir una proforma",
);
assert.doesNotMatch(
  modal,
  /setSuccessMessage\("Cambios guardados correctamente"\)[\s\S]{0,200}onClose\(/,
  "guardar cambios no debe cerrar el modal",
);
assert.match(modal, /Ver proforma/);
assert.match(modal, /Actualizar\/generar nueva proforma/);
assert.match(modal, /disabled=\{readonly \|\| isConfirmedEdit\}[\s\S]*value=\{fob\}/);
assert.match(modal, /disabled=\{readonly \|\| isConfirmedEdit\}[\s\S]*value=\{fecha\}/);
assert.match(modal, /disabled=\{readonly \|\| isConfirmedEdit\}[\s\S]*value=\{item\.cantidad\}/);
assert.match(
  modal,
  /disabled=\{isConfirmedEdit\}[\s\S]{0,120}value=\{item\.coste_unitario_moneda/,
);
assert.match(modal, /disabled=\{readonly \|\| isConfirmedEdit\}[\s\S]*value=\{item\.lote_producto/);
assert.match(modal, /value=\{monedaCompra\}[\s\S]{0,120}disabled=\{isConfirmedEdit\}/);
assert.doesNotMatch(modal, /tipoCambio|setTipoCambio|1 \{monedaCompra\} = EUR/);

assert.match(proformaSql, /CREATE TABLE IF NOT EXISTS public\.order_proforma_versions/);
assert.match(proformaSql, /UNIQUE \(orden_id, version\)/);
assert.match(proformaRoute, /export async function GET/);
assert.match(proformaRoute, /order_proforma_versions/);
assert.match(proformaRoute, /export async function POST/);
assert.match(proformaRoute, /SIGNED_PROFORMA_EXISTS/);
assert.match(proformaRoute, /confirm_signed/);
assert.doesNotMatch(
  proformaRoute,
  /proforma_firmada_url:\s*/,
  "generar una versión no firmada no debe sobrescribir la proforma firmada",
);

assert.match(reopenService, /reopen_confirmed_purchase_order/);
assert.match(reopenService, /p_motivo:\s*motivo \?\? null/);

console.log("orders confirmed operations/proforma separation: ok");
