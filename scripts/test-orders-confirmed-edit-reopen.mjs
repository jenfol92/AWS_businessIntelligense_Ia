import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

const updateConfirmedService = read("modules/orders/services/updateConfirmedOrderService.ts");
const reopenService = read("modules/orders/services/reopenOrder.ts");
const financePaymentsRepository = read("modules/finance/repositories/financeSupplierPaymentsRepository.ts");
const financePaymentTypes = read("modules/finance/types/supplierPayments.types.ts");
const rpcSql = read("sql/migrations/20260720_confirmed_order_edit_reopen_rpcs.sql");
const useReopenOrder = read("modules/orders/hooks/useReopenOrder.ts");
const orderClient = read("modules/orders/api/orderClient.ts");
const pedidosPage = read("app/[locale]/(dashboard)/pedidos/page.tsx");

assert.match(
  updateConfirmedService,
  /update_confirmed_purchase_order/,
  "la edicion confirmada debe usar la RPC transaccional unificada",
);
assert.doesNotMatch(
  updateConfirmedService,
  /update_confirmed_purchase_order_costs/,
  "la edicion confirmada no debe llamar a la RPC de costes por existir item_id",
);
assert.doesNotMatch(
  updateConfirmedService,
  /filter\(\(item\) => item\.item_id\)/,
  "no basta con item_id para considerar una linea como cambio economico",
);
assert.match(
  updateConfirmedService,
  /hasOwnProperty\.call\(item, "coste_unitario_moneda"\)/,
  "el servicio debe preservar la diferencia entre coste omitido y coste null",
);
assert.doesNotMatch(
  updateConfirmedService,
  /coste_unitario_moneda:\s*item\.coste_unitario_moneda \?\? null/,
  "el servicio no debe convertir coste omitido en null",
);
assert.doesNotMatch(
  updateConfirmedService,
  /from\(["']orden_items["']\)[\s\S]{0,300}\.update\(\s*patch\s*\)/,
  "la edicion confirmada no debe actualizar orden_items directamente",
);
assert.doesNotMatch(
  updateConfirmedService,
  /const patch:\s*Record<string,\s*unknown>\s*=\s*\{\s*updated_at:/,
  "la edicion de linea no debe incluir updated_at porque orden_items no tiene esa columna",
);

assert.match(
  reopenService,
  /p_motivo:\s*motivo \?\? null/,
  "la reapertura debe enviar el motivo a la RPC",
);
assert.match(
  reopenService,
  /reopen_confirmed_purchase_order/,
  "la reapertura debe usar la RPC transaccional",
);
assert.doesNotMatch(
  reopenService,
  /from\(["']ordenes_compra["']\)[\s\S]{0,300}\.update\(/,
  "la reapertura no debe hacer UPDATE directo fuera de la RPC",
);

assert.doesNotMatch(
  financePaymentsRepository,
  /status:\s*["']anulado["']/,
  "finance_supplier_payments.status no permite anulado",
);
assert.doesNotMatch(
  financePaymentTypes,
  /anulado|inactive/,
  "los tipos de pagos proveedor deben reflejar solo los estados reales",
);
assert.match(
  financePaymentsRepository,
  /\.from\(["']finance_supplier_payments["']\)\s*[\s\S]{0,120}\.delete\(\)[\s\S]{0,160}\.in\(["']status["'], \["pendiente", "vencido"\]\)/,
  "los pagos pendiente/vencido se eliminan controladamente al volver a borrador",
);

assert.match(rpcSql, /CREATE OR REPLACE FUNCTION public\.reopen_confirmed_purchase_order/);
assert.match(rpcSql, /p_motivo text DEFAULT NULL/);
assert.match(rpcSql, /REAPERTURA:/);
assert.match(rpcSql, /FOR UPDATE/);
assert.match(rpcSql, /status = 'pagado'/);
assert.match(rpcSql, /No se puede reabrir la orden porque tiene pagos realizados/);
assert.match(rpcSql, /DELETE FROM public\.finance_supplier_payments[\s\S]*status IN \('pendiente', 'vencido'\)/);
assert.doesNotMatch(rpcSql, /finance_supplier_payments[\s\S]{0,200}(anulado|cancelado|inactive)/);

assert.match(rpcSql, /DROP FUNCTION IF EXISTS public\.update_confirmed_purchase_order_costs\(uuid, jsonb\)/);
assert.doesNotMatch(rpcSql, /CREATE OR REPLACE FUNCTION public\.update_confirmed_purchase_order_costs/);
assert.doesNotMatch(rpcSql, /GRANT EXECUTE ON FUNCTION public\.update_confirmed_purchase_order_costs/);
assert.doesNotMatch(rpcSql, /UPDATE public\.orden_items[\s\S]{0,300}updated_at/);
assert.match(rpcSql, /upsert_current_factory_cost_by_currency/);
assert.match(rpcSql, /v_currency/);

assert.match(rpcSql, /^BEGIN;/m);
assert.match(rpcSql, /^COMMIT;/m);
assert.match(rpcSql, /CREATE OR REPLACE FUNCTION public\.update_confirmed_purchase_order\(/);
assert.match(rpcSql, /p_header jsonb/);
assert.match(rpcSql, /p_items jsonb/);
assert.match(
  rpcSql,
  /raw\.elem \? 'coste_unitario_moneda'[\s\S]*IS DISTINCT FROM oi\.coste_unitario_moneda/,
  "la RPC unificada debe comparar solo claves economicas presentes",
);
assert.match(
  rpcSql,
  /v_changed_cost_count > 0[\s\S]*status = 'pagado'/,
  "solo los cambios de coste deben bloquearse por pagos pagados",
);
assert.match(
  rpcSql,
  /v_changed_tipo_envio[\s\S]*v_changed_payments := v_changed_eta OR v_changed_tipo_envio OR v_changed_cost_count > 0/,
  "cambiar tipo_envio debe recalcular pagos pendientes/vencidos",
);
assert.match(
  rpcSql,
  /WHERE fsp\.orden_id = p_order_id\s+AND fsp\.status IN \('pendiente', 'vencido'\)/,
  "solo se recalculan pagos pendiente/vencido",
);
assert.match(
  rpcSql,
  /v_changed_cost_count > 0[\s\S]*fsp\.payment_type = 'BALANCE_70'/,
  "ETA/ETD o tipo_envio solo deben recalcular pagos dependientes de vencimiento, no depositos",
);
assert.doesNotMatch(
  rpcSql,
  /v_changed_eta :=[\s\S]{0,500}destino/,
  "cambiar solo destino no debe recalcular pagos ni costes",
);
assert.match(
  rpcSql,
  /UPDATE public\.ordenes_compra oc[\s\S]*updated_at = now\(\)/,
  "la cabecera confirmada se actualiza dentro de la RPC",
);
assert.match(
  rpcSql,
  /coste_total_eur = coalesce\(\([\s\S]*WHEN v_currency = 'EUR' THEN oi\.coste_unitario_moneda/,
  "para moneda EUR el total EUR debe recalcularse desde lineas nuevas",
);
assert.match(
  rpcSql,
  /oi\.id = ANY\(v_changed_item_ids\)[\s\S]*upsert_current_factory_cost_by_currency/,
  "producto_costos debe limitarse a lineas realmente cambiadas",
);
assert.match(rpcSql, /logistics_type = CASE/);

assert.match(orderClient, /Promise<OrdenCompraRow>/);
assert.match(useReopenOrder, /if \(saving\) return/);
assert.match(useReopenOrder, /fetchOrderDetail\(orderId\)/);
assert.match(pedidosPage, /ordersList\.patchOrder\(\{[\s\S]*estado: "borrador"/);
assert.match(pedidosPage, /onSaved=\{\(orden\) =>[\s\S]*ordersList\.patchOrder\(orden/);

const orderFormModal = read("modules/orders/components/OrderFormModal.tsx");
assert.match(orderFormModal, /disabled=\{readonly \|\| isConfirmedEdit\}[\s\S]*value=\{fecha\}/);
assert.match(orderFormModal, /disabled=\{readonly \|\| isConfirmedEdit\}[\s\S]*value=\{cbmLimite\}/);
assert.match(orderFormModal, /value=\{monedaCompra\}[\s\S]{0,120}disabled=\{isConfirmedEdit\}/);
assert.match(orderFormModal, /disabled=\{monedaCompra === "EUR" \|\| isConfirmedEdit\}/);
assert.match(orderFormModal, /disabled=\{readonly \|\| isConfirmedEdit\}[\s\S]*value=\{item\.cantidad\}/);
assert.match(orderFormModal, /disabled=\{readonly \|\| isConfirmedEdit\}[\s\S]*value=\{item\.lote_producto/);

const omittedCostItem = { item_id: "item-1" };
const nullCostItem = { item_id: "item-1", coste_unitario_moneda: null };
assert.equal(Object.prototype.hasOwnProperty.call(omittedCostItem, "coste_unitario_moneda"), false);
assert.equal(Object.prototype.hasOwnProperty.call(nullCostItem, "coste_unitario_moneda"), true);

console.log("orders confirmed edit/reopen hardening: ok");
