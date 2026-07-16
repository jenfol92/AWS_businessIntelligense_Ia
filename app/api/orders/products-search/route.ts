/**
 * Modulo   : orders
 * Archivo  : app/api/orders/products-search/route.ts
 * Que hace : GET — busca productos activos para añadir a una orden de compra.
 *            Devuelve nombre, SKU, CBM, coste, stock, cobertura e imagen.
 * Responsabilidad : Consultar productos, producto_logistica, producto_costos,
 *                   inventario_paises y ventas_diarias para componer la respuesta.
 * No debe          : Modificar datos ni filtrar por estados de orden.
 */

import { NextResponse } from "next/server";
import { resolveFactoryCostsForProductSearch } from "@/modules/orders/services/resolveFactoryCostsForProducts";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

/**
 * GET /api/orders/products-search
 *
 * Query params:
 * @param q - Texto a buscar en nombre, SKU, categoria, proveedor o puerto preferido
 *
 * Devuelve hasta 20 productos activos que coincidan con el termino de busqueda.
 * Si q esta vacio, devuelve los primeros 100 productos activos sin filtrar.
 */
export async function GET(req: Request) {
  const supabase = createSupabaseRouteClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const moneda = (searchParams.get("moneda") ?? "").trim().toUpperCase() || null;

  // Productos activos con proveedor
  const { data: productos, error: prodError } = await supabase
    .from("productos")
    .select("id, sku, nombre, estado, proveedor_id, proveedores(id, nombre, puerto_preferido)")
    .eq("estado", "activo")
    .limit(100);

  if (prodError) {
    return NextResponse.json({ ok: false, error: prodError.message }, { status: 400 });
  }

  if (!productos || productos.length === 0) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  const allIds = (productos as Array<{ id: string }>).map((p) => p.id);

  // Imagen y categoria
  const { data: detalle } = await supabase
    .from("producto_detalle")
    .select("producto_id, imagen_url, categoria")
    .in("producto_id", allIds);

  const detalleMap: Record<string, { imagen_url: string | null; categoria: string | null }> = {};
  for (const d of detalle ?? []) {
    detalleMap[(d as any).producto_id] = d as any;
  }

  // CBM unitario desde logistica
  const { data: logistica } = await supabase
    .from("producto_logistica")
    .select("producto_id, cubicaje_unitario_m3")
    .in("producto_id", allIds);

  const cbmMap: Record<string, number> = {};
  for (const l of logistica ?? []) {
    cbmMap[(l as any).producto_id] = Number((l as any).cubicaje_unitario_m3 ?? 0);
  }

  // Coste de fabrica historico: orden_items confirmado/recibido, con producto_costos como fallback.
  const factoryCostMap = await resolveFactoryCostsForProductSearch(
    (productos as Array<{ id: string; proveedor_id: string | null }>).map((p) => ({
      producto_id: p.id,
      proveedor_id: p.proveedor_id ?? null,
    })),
    supabase,
    moneda,
  );

  // Stock agregado por pais (FBA + FBM)
  const { data: inv } = await supabase
    .from("inventario_paises")
    .select("producto_id, stock_fba, stock_fbm")
    .in("producto_id", allIds);

  const stockMap: Record<string, { fba: number; fbm: number }> = {};
  for (const i of inv ?? []) {
    const pid = (i as any).producto_id;
    const prev = stockMap[pid] ?? { fba: 0, fbm: 0 };
    prev.fba += Number((i as any).stock_fba ?? 0);
    prev.fbm += Number((i as any).stock_fbm ?? 0);
    stockMap[pid] = prev;
  }

  // Ventas ultimos 30 dias para calcular cobertura estimada
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data: ventas } = await supabase
    .from("ventas_diarias")
    .select("producto_id, unidades_vendidas")
    .in("producto_id", allIds)
    .gte("fecha", since.toISOString().slice(0, 10));

  const ventasMap: Record<string, number> = {};
  for (const v of ventas ?? []) {
    const pid = (v as any).producto_id;
    ventasMap[pid] = (ventasMap[pid] ?? 0) + Number((v as any).unidades_vendidas ?? 0);
  }

  // Componer resultado
  let rows = (productos as any[]).map((p) => {
    const det = detalleMap[p.id] ?? { imagen_url: null, categoria: null };
    const st  = stockMap[p.id] ?? { fba: 0, fbm: 0 };
    const stockTotal = st.fba + st.fbm;
    const avgDaily   = (ventasMap[p.id] ?? 0) / 30;
    const diasCobertura = avgDaily > 0 ? Math.round(stockTotal / avgDaily) : null;
    const prov = Array.isArray(p.proveedores) ? p.proveedores[0] : p.proveedores;

    const factory = factoryCostMap.get(`${p.id}:${p.proveedor_id ?? ""}`);
    const monedaProducto = factory?.costo_fabrica_moneda ?? null;
    const monto = factory?.costo_fabrica_monto ?? null;

    return {
      producto_id:       p.id,
      sku:               p.sku as string,
      nombre:            p.nombre as string,
      imagen_url:        det.imagen_url,
      categoria:         det.categoria,
      proveedor_id:      p.proveedor_id ?? null,
      proveedor_nombre:  (prov as any)?.nombre ?? null,
      puerto_preferido:  (prov as any)?.puerto_preferido ?? null,
      stock_fba:         st.fba,
      stock_fbm:         st.fbm,
      stock_total:       stockTotal,
      dias_cobertura:    diasCobertura,
      cbm_unitario:      cbmMap[p.id] ?? 0,
      coste_unitario_moneda: monto,
      moneda_producto:   monedaProducto,
      coste_fabrica_eur: factory?.costo_fabrica_eur ?? null,
      tipo_cambio_aplicado: factory?.tipo_cambio_aplicado ?? null,
      sin_coste_historico: !monto,
      coste_unitario_usd:
        monedaProducto === "USD" ? monto : null,
    };
  });

  // Filtro textual: nombre, SKU, categoria, proveedor, puerto
  if (q) {
    rows = rows.filter(
      (r) =>
        r.nombre.toLowerCase().includes(q) ||
        r.sku.toLowerCase().includes(q) ||
        (r.categoria ?? "").toLowerCase().includes(q) ||
        (r.proveedor_nombre ?? "").toLowerCase().includes(q) ||
        (r.puerto_preferido ?? "").toLowerCase().includes(q),
    );
  }

  return NextResponse.json({ ok: true, rows: rows.slice(0, 20) });
}
