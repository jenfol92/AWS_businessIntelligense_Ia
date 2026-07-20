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
  /update_confirmed_purchase_order_costs/,
  "la edicion confirmada debe usar la RPC transaccional de costes",
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
assert.match(rpcSql, /FOR UPDATE/);
assert.match(rpcSql, /status = 'pagado'/);
assert.match(rpcSql, /No se puede reabrir la orden porque tiene pagos realizados/);
assert.match(rpcSql, /DELETE FROM public\.finance_supplier_payments[\s\S]*status IN \('pendiente', 'vencido'\)/);
assert.doesNotMatch(rpcSql, /anulado|cancelado|inactive/);

assert.match(rpcSql, /CREATE OR REPLACE FUNCTION public\.update_confirmed_purchase_order_costs/);
assert.match(rpcSql, /No se puede modificar el coste porque la orden tiene pagos realizados/);
assert.match(rpcSql, /UPDATE public\.orden_items oi\s+SET\s+coste_unitario_moneda/);
assert.doesNotMatch(rpcSql, /UPDATE public\.orden_items[\s\S]{0,300}updated_at/);
assert.match(rpcSql, /upsert_current_factory_cost_by_currency/);
assert.match(rpcSql, /v_currency/);

assert.match(orderClient, /Promise<OrdenCompraRow>/);
assert.match(useReopenOrder, /if \(saving\) return/);
assert.match(useReopenOrder, /fetchOrderDetail\(orderId\)/);
assert.match(pedidosPage, /ordersList\.patchOrder\(\{[\s\S]*estado: "borrador"/);

console.log("orders confirmed edit/reopen hardening: ok");
