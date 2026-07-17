import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const serviceRoleKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const userEmail = process.env.SUPABASE_TEST_USER_EMAIL;
const userPassword = process.env.SUPABASE_TEST_USER_PASSWORD;

if (!url || !serviceRoleKey || !anonKey || !userEmail || !userPassword) {
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
const userSupabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonymousSupabase = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function uuid(label) {
  const hex = Buffer.from(label.padEnd(16, "0").slice(0, 16)).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const productId = uuid("cost-product");
const orderId = uuid("cost-order");
const itemId = uuid("cost-item");

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

await must(
  "cleanup producto_costos",
  adminSupabase.from("producto_costos").delete().eq("producto_id", productId),
);
await must("cleanup orden_items", adminSupabase.from("orden_items").delete().eq("orden_id", orderId));
await must("cleanup orden", adminSupabase.from("ordenes_compra").delete().eq("id", orderId));
await must("cleanup producto", adminSupabase.from("productos").delete().eq("id", productId));

await must(
  "insert producto",
  adminSupabase.from("productos").insert({
    id: productId,
    sku: "RPC-COST-TEST",
    nombre: "RPC Cost Test",
    estado: "activo",
  }),
);
await must(
  "insert USD vigente",
  adminSupabase.from("producto_costos").insert({
    producto_id: productId,
    costo_fabrica_moneda: "USD",
    costo_fabrica_monto: 10,
    fecha: "2026-07-17",
  }),
);
await must(
  "insert orden",
  adminSupabase.from("ordenes_compra").insert({
    id: orderId,
    estado: "borrador",
    moneda_compra: "CNY",
    eta: "2026-08-01",
  }),
);
await must(
  "insert item",
  adminSupabase.from("orden_items").insert({
    id: itemId,
    orden_id: orderId,
    producto_id: productId,
    cantidad: 1,
  }),
);

const { error: signInError } = await userSupabase.auth.signInWithPassword({
  email: userEmail,
  password: userPassword,
});
if (signInError) throw new Error(`sign in test user: ${signInError.message}`);

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

await must(
  "confirm rpc as authenticated user",
  userSupabase.rpc("confirm_order_with_current_factory_costs", {
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
  userSupabase.rpc("confirm_order_with_current_factory_costs", {
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

console.log("current factory costs RPC integration: ok");
