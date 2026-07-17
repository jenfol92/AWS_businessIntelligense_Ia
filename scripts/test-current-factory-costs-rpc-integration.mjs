import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const userEmail = process.env.SUPABASE_TEST_USER_EMAIL;
const userPassword = process.env.SUPABASE_TEST_USER_PASSWORD;
const unauthorizedEmail = process.env.SUPABASE_TEST_UNAUTHORIZED_USER_EMAIL;
const unauthorizedPassword = process.env.SUPABASE_TEST_UNAUTHORIZED_USER_PASSWORD;

if (
  !url ||
  !serviceRoleKey ||
  !anonKey ||
  !userEmail ||
  !userPassword ||
  !unauthorizedEmail ||
  !unauthorizedPassword
) {
  console.log("RPC no ejecutada; solo validacion estatica");
  process.exit(0);
}

if (!/localhost|127\.0\.0\.1/.test(url) && process.env.SUPABASE_TEST_ALLOW_REMOTE !== "1") {
  throw new Error(
    "El test RPC solo puede ejecutarse contra Supabase local o una base de pruebas explicitamente autorizada.",
  );
}

const adminSupabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const authorizedSupabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const unauthorizedSupabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonymousSupabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function uuid(label) {
  const hex = Buffer.from(label.padEnd(16, "0").slice(0, 16)).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const supplierAId = uuid("cost-supplier-a");
const supplierBId = uuid("cost-supplier-b");
const productId = uuid("cost-product");
const unauthorizedProductId = uuid("cost-noauth-prod");
const rollbackProductId = uuid("cost-rollback-p");
const orderId = uuid("cost-order");
const unauthorizedOrderId = uuid("cost-noauth-ord");
const rollbackOrderId = uuid("cost-rollback-o");
const itemId = uuid("cost-item");
const unauthorizedItemId = uuid("cost-noauth-itm");
const rollbackItemAId = uuid("cost-roll-itm-a");
const rollbackItemBId = uuid("cost-roll-itm-b");

const productIds = [productId, unauthorizedProductId, rollbackProductId];
const orderIds = [orderId, unauthorizedOrderId, rollbackOrderId];
const supplierIds = [supplierAId, supplierBId];

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function cleanup() {
  await must(
    "cleanup producto_costos",
    adminSupabase.from("producto_costos").delete().in("producto_id", productIds),
  );
  await must("cleanup orden_items", adminSupabase.from("orden_items").delete().in("orden_id", orderIds));
  await must("cleanup ordenes", adminSupabase.from("ordenes_compra").delete().in("id", orderIds));
  await must("cleanup productos", adminSupabase.from("productos").delete().in("id", productIds));
  await must("cleanup proveedores", adminSupabase.from("proveedores").delete().in("id", supplierIds));
}

async function insertProduct(id, sku) {
  await must(
    `insert producto ${sku}`,
    adminSupabase.from("productos").insert({
      id,
      sku,
      nombre: sku,
      estado: "activo",
    }),
  );
}

async function insertOrder(id) {
  await must(
    `insert orden ${id}`,
    adminSupabase.from("ordenes_compra").insert({
      id,
      estado: "borrador",
      moneda_compra: "CNY",
      eta: "2026-08-01",
    }),
  );
}

async function signIn(client, email, password, label) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`${label}: ${error.message}`);
}

try {
  await cleanup();

  await must(
    "insert proveedores",
    adminSupabase.from("proveedores").insert([
      { id: supplierAId, nombre: "RPC Cost Supplier A" },
      { id: supplierBId, nombre: "RPC Cost Supplier B" },
    ]),
  );

  await insertProduct(productId, "RPC-COST-TEST");
  await insertProduct(unauthorizedProductId, "RPC-COST-NOAUTH");
  await insertProduct(rollbackProductId, "RPC-COST-ROLLBACK");

  await must(
    "insert USD vigente producto valido",
    adminSupabase.from("producto_costos").insert({
      producto_id: productId,
      proveedor_id: supplierAId,
      costo_fabrica_moneda: "USD",
      costo_fabrica_monto: 10,
      fecha: "2026-07-17",
    }),
  );
  await must(
    "insert USD vigente rollback",
    adminSupabase.from("producto_costos").insert({
      producto_id: rollbackProductId,
      proveedor_id: supplierAId,
      costo_fabrica_moneda: "USD",
      costo_fabrica_monto: 10,
      fecha: "2026-07-17",
    }),
  );

  await insertOrder(orderId);
  await insertOrder(unauthorizedOrderId);
  await insertOrder(rollbackOrderId);

  await must(
    "insert items",
    adminSupabase.from("orden_items").insert([
      {
        id: itemId,
        orden_id: orderId,
        producto_id: productId,
        proveedor_id: supplierAId,
        cantidad: 1,
      },
      {
        id: unauthorizedItemId,
        orden_id: unauthorizedOrderId,
        producto_id: unauthorizedProductId,
        proveedor_id: supplierAId,
        cantidad: 1,
      },
      {
        id: rollbackItemAId,
        orden_id: rollbackOrderId,
        producto_id: rollbackProductId,
        proveedor_id: supplierAId,
        cantidad: 1,
      },
      {
        id: rollbackItemBId,
        orden_id: rollbackOrderId,
        producto_id: rollbackProductId,
        proveedor_id: supplierBId,
        cantidad: 1,
      },
    ]),
  );

  await signIn(authorizedSupabase, userEmail, userPassword, "sign in authorized test user");
  await signIn(
    unauthorizedSupabase,
    unauthorizedEmail,
    unauthorizedPassword,
    "sign in unauthorized test user",
  );

  const anonymousConfirm = await anonymousSupabase.rpc("confirm_order_with_current_factory_costs", {
    p_order_id: orderId,
    p_eta: "2026-08-01",
    p_moneda_compra: "CNY",
    p_items: [{ item_id: itemId, coste_unitario_moneda: 75 }],
  });
  assert(
    anonymousConfirm.error,
    "usuario anonimo no autenticado no debe poder ejecutar confirm_order_with_current_factory_costs",
  );

  const unauthorizedConfirm = await unauthorizedSupabase.rpc(
    "confirm_order_with_current_factory_costs",
    {
      p_order_id: unauthorizedOrderId,
      p_eta: "2026-08-01",
      p_moneda_compra: "CNY",
      p_items: [{ item_id: unauthorizedItemId, coste_unitario_moneda: 75 }],
    },
  );
  assert(
    unauthorizedConfirm.error,
    "usuario autenticado sin permisos no debe poder confirmar ordenes",
  );

  await must(
    "confirm rpc as authorized authenticated user",
    authorizedSupabase.rpc("confirm_order_with_current_factory_costs", {
      p_order_id: orderId,
      p_eta: "2026-08-01",
      p_moneda_compra: "CNY",
      p_items: [{ item_id: itemId, coste_unitario_moneda: 75 }],
    }),
  );

  const costs = await must(
    "read costs",
    adminSupabase
      .from("producto_costos")
      .select("costo_fabrica_moneda,costo_fabrica_monto,contenedor_id,lote_producto")
      .eq("producto_id", productId)
      .is("contenedor_id", null)
      .is("lote_producto", null),
  );
  assert.equal(costs.find((row) => row.costo_fabrica_moneda === "USD")?.costo_fabrica_monto, 10);
  assert.equal(costs.find((row) => row.costo_fabrica_moneda === "CNY")?.costo_fabrica_monto, 75);

  await must(
    "confirm rpc idempotente",
    authorizedSupabase.rpc("confirm_order_with_current_factory_costs", {
      p_order_id: orderId,
      p_eta: "2026-08-01",
      p_moneda_compra: "CNY",
      p_items: [{ item_id: itemId, coste_unitario_moneda: 75 }],
    }),
  );

  const duplicates = await must(
    "read duplicate count",
    adminSupabase
      .from("producto_costos")
      .select("id")
      .eq("producto_id", productId)
      .eq("costo_fabrica_moneda", "CNY")
      .is("contenedor_id", null)
      .is("lote_producto", null),
  );
  assert.equal(duplicates.length, 1);

  const rollbackAttempt = await authorizedSupabase.rpc("confirm_order_with_current_factory_costs", {
    p_order_id: rollbackOrderId,
    p_eta: "2026-08-01",
    p_moneda_compra: "CNY",
    p_items: [
      { item_id: rollbackItemAId, coste_unitario_moneda: 80 },
      { item_id: rollbackItemBId, coste_unitario_moneda: 80 },
    ],
  });
  assert(
    rollbackAttempt.error,
    "la orden de rollback debe fallar despues de actualizar las lineas dentro del RPC",
  );

  const rollbackOrder = await must(
    "read rollback order",
    adminSupabase
      .from("ordenes_compra")
      .select("estado")
      .eq("id", rollbackOrderId)
      .single(),
  );
  assert.equal(rollbackOrder.estado, "borrador");

  const rollbackItems = await must(
    "read rollback items",
    adminSupabase
      .from("orden_items")
      .select("id,coste_unitario_moneda,coste_unitario_usd,coste_unitario_eur,lote_producto")
      .eq("orden_id", rollbackOrderId),
  );
  assert.equal(rollbackItems.length, 2);
  for (const item of rollbackItems) {
    assert.equal(item.coste_unitario_moneda, null);
    assert.equal(item.coste_unitario_usd, null);
    assert.equal(item.coste_unitario_eur, null);
    assert.equal(item.lote_producto, null);
  }

  const rollbackCosts = await must(
    "read rollback costs",
    adminSupabase
      .from("producto_costos")
      .select("costo_fabrica_moneda,costo_fabrica_monto")
      .eq("producto_id", rollbackProductId)
      .is("contenedor_id", null)
      .is("lote_producto", null),
  );
  assert.deepEqual(
    rollbackCosts.map((row) => [row.costo_fabrica_moneda, row.costo_fabrica_monto]),
    [["USD", 10]],
  );

  console.log("current factory costs RPC integration: ok");
} finally {
  await cleanup();
}
