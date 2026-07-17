import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repoRoot = process.cwd();
const moduleCache = new Map();
const nodeRequire = createRequire(import.meta.url);

function resolveModule(specifier, parentFile) {
  if (specifier.startsWith("@/")) {
    return path.join(repoRoot, specifier.slice(2));
  }
  if (specifier.startsWith(".")) {
    return path.resolve(path.dirname(parentFile), specifier);
  }
  return specifier;
}

function requireTs(specifier, parentFile = path.join(repoRoot, "scripts", "root.cjs")) {
  const resolved = resolveModule(specifier, parentFile);
  if (!path.isAbsolute(resolved)) {
    return nodeRequire(resolved);
  }

  const filePath = fs.existsSync(resolved)
    ? resolved
    : fs.existsSync(`${resolved}.ts`)
      ? `${resolved}.ts`
      : fs.existsSync(`${resolved}.tsx`)
        ? `${resolved}.tsx`
        : fs.existsSync(`${resolved}.js`)
          ? `${resolved}.js`
          : resolved;

  if (moduleCache.has(filePath)) return moduleCache.get(filePath).exports;

  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
    fileName: filePath,
  }).outputText;

  const module = { exports: {} };
  moduleCache.set(filePath, module);
  const localRequire = (childSpecifier) => requireTs(childSpecifier, filePath);
  const fn = new Function("require", "module", "exports", "__filename", "__dirname", transpiled);
  fn(localRequire, module, module.exports, filePath, path.dirname(filePath));
  return module.exports;
}

const {
  assertProductCostCurrency,
} = requireTs("../modules/products/utils/productCostCurrency.ts");
const {
  resolveCurrentFactoryCostDisplay,
} = requireTs("../modules/products/utils/currentFactoryCostDisplay.ts");
const {
  buildCompleteOrderItemCostPatches,
  normalizeOrderCostCurrency,
} = requireTs("../modules/orders/services/confirmOrderValidation.ts");
const {
  selectLatestConfirmedCostByProductCurrency,
} = requireTs("../modules/products/utils/currentFactoryCostBackfill.ts");

assert.equal(assertProductCostCurrency("usd"), "USD");
assert.equal(assertProductCostCurrency("CNY"), "CNY");
assert.throws(() => assertProductCostCurrency("RMB"), /Moneda de coste no valida/);
assert.throws(() => normalizeOrderCostCurrency("GNY"), /Moneda de coste no valida/);

const displayUsd = resolveCurrentFactoryCostDisplay({
  costoFabricaMonto: 10,
  costoFabricaMoneda: "USD",
  factoryCostsByCurrency: {
    USD: { monto: 10, moneda: "USD", fecha: "2026-07-17" },
    CNY: { monto: 70, moneda: "CNY", fecha: "2026-07-17" },
  },
});
assert.equal(displayUsd.label, "10 USD");

const displayCny = resolveCurrentFactoryCostDisplay({
  costoFabricaMonto: 75,
  costoFabricaMoneda: "CNY",
  factoryCostsByCurrency: {
    USD: { monto: 10, moneda: "USD", fecha: "2026-07-17" },
    CNY: { monto: 70, moneda: "CNY", fecha: "2026-07-17" },
  },
});
assert.equal(displayCny.label, "75 CNY");

const displayGbp = resolveCurrentFactoryCostDisplay({
  costoFabricaMonto: 0,
  costoFabricaMoneda: "GBP",
  factoryCostsByCurrency: {
    USD: { monto: 10, moneda: "USD", fecha: "2026-07-17" },
    CNY: { monto: 75, moneda: "CNY", fecha: "2026-07-17" },
  },
});
assert.equal(displayGbp.label, "-");

const orderItems = [
  { id: "item-1", orden_id: "order-1", producto_id: "product-1" },
  { id: "item-2", orden_id: "order-1", producto_id: "variant-1" },
];

const completePatches = buildCompleteOrderItemCostPatches(orderItems, [
  { item_id: "item-1", coste_unitario_moneda: 10 },
  { item_id: "item-2", coste_unitario_moneda: 75 },
]);
assert.deepEqual(
  completePatches.map((patch) => [patch.item_id, patch.producto_id, patch.coste_unitario_moneda]),
  [
    ["item-1", "product-1", 10],
    ["item-2", "variant-1", 75],
  ],
);

assert.throws(
  () =>
    buildCompleteOrderItemCostPatches(orderItems, [
      { item_id: "item-1", coste_unitario_moneda: 10 },
    ]),
  /Faltan costes/,
);
assert.throws(
  () =>
    buildCompleteOrderItemCostPatches(orderItems, [
      { item_id: "item-1", coste_unitario_moneda: 10 },
      { item_id: "item-1", coste_unitario_moneda: 11 },
    ]),
  /Linea repetida/,
);
assert.throws(
  () =>
    buildCompleteOrderItemCostPatches(orderItems, [
      { item_id: "item-1", coste_unitario_moneda: 10 },
      { item_id: "item-3", coste_unitario_moneda: 11 },
    ]),
  /no pertenece/,
);
assert.throws(
  () =>
    buildCompleteOrderItemCostPatches(
      [{ id: "item-1", orden_id: "order-1", producto_id: null }],
      [{ item_id: "item-1", coste_unitario_moneda: 10 }],
    ),
  /no tiene producto/,
);
assert.throws(
  () =>
    buildCompleteOrderItemCostPatches(orderItems, [
      { item_id: "item-1", coste_unitario_moneda: 0 },
      { item_id: "item-2", coste_unitario_moneda: 75 },
    ]),
  /coste unitario valido/,
);

const latest = selectLatestConfirmedCostByProductCurrency([
  {
    orderId: "old",
    productId: "product-1",
    currency: "CNY",
    amount: 70,
    confirmedAt: "2026-07-01",
    createdAt: "2026-07-01T10:00:00Z",
  },
  {
    orderId: "new",
    productId: "product-1",
    currency: "CNY",
    amount: 75,
    confirmedAt: "2026-07-15",
    createdAt: "2026-07-15T10:00:00Z",
  },
  {
    orderId: "usd",
    productId: "product-1",
    currency: "USD",
    amount: 10,
    confirmedAt: "2026-07-10",
    createdAt: "2026-07-10T10:00:00Z",
  },
]);
assert.deepEqual(
  latest
    .map((row) => [row.productId, row.currency, row.amount, row.orderId])
    .sort(),
  [
    ["product-1", "CNY", 75, "new"],
    ["product-1", "USD", 10, "usd"],
  ],
);

const confirmRpcSql = fs.readFileSync(
  path.join(repoRoot, "sql/migrations/20260717_confirm_order_with_current_factory_costs_rpc.sql"),
  "utf8",
);
assert.match(confirmRpcSql, /CREATE OR REPLACE FUNCTION public\.confirm_order_with_current_factory_costs/);
assert.match(confirmRpcSql, /FOR UPDATE/);
assert.match(confirmRpcSql, /upsert_current_factory_cost_by_currency/);
assert.match(confirmRpcSql, /estado = 'confirmado'/);
assert.match(confirmRpcSql, /v_order\.estado = 'confirmado'[\s\S]*RETURN v_order/);
assert.match(confirmRpcSql, /mismo producto con costes distintos/);
assert.match(confirmRpcSql, /mismo producto con proveedores distintos/);
assert.match(confirmRpcSql, /REVOKE EXECUTE ON FUNCTION public\.confirm_order_with_current_factory_costs/);
assert.doesNotMatch(confirmRpcSql, /min\(oi\.proveedor_id\)/);

const currentCostSql = fs.readFileSync(
  path.join(repoRoot, "sql/migrations/20260717_current_factory_costs_by_currency.sql"),
  "utf8",
);
assert.match(currentCostSql, /REVOKE EXECUTE ON FUNCTION public\.upsert_current_factory_cost_by_currency/);

const confirmService = fs.readFileSync(
  path.join(repoRoot, "modules/orders/services/confirmOrderService.ts"),
  "utf8",
);
assert.match(confirmService, /confirmOrderWithCurrentFactoryCostsRpc/);
assert.doesNotMatch(confirmService, /updateOrderItemCostsForConfirmation/);
assert.doesNotMatch(confirmService, /confirmOrderHeader/);
assert.doesNotMatch(confirmService, /upsertCurrentFactoryCostByCurrency/);

const confirmRepository = fs.readFileSync(
  path.join(repoRoot, "modules/orders/repositories/orderConfirmRepository.ts"),
  "utf8",
);
assert.doesNotMatch(confirmRepository, /export async function updateOrderItemCostsForConfirmation/);
assert.doesNotMatch(confirmRepository, /export async function fetchOrderItemsForConfirmation/);
assert.doesNotMatch(confirmRepository, /export async function fetchOrderHeaderForConfirmation/);
assert.doesNotMatch(confirmRepository, /export async function confirmOrderHeader/);
assert.match(confirmRepository, /confirmOrderWithCurrentFactoryCostsRpc/);

const snapshotRepositoryUrl = pathToFileURL(
  path.join(repoRoot, "modules/orders/repositories/orderConfirmedCostSnapshotRepository.ts"),
).href;
assert.ok(snapshotRepositoryUrl.includes("orderConfirmedCostSnapshotRepository.ts"));

console.log("current factory costs hardening: ok");
