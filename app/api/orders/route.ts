/**
 * Módulo   : orders
 * Archivo  : app/api/orders/route.ts
 * Qué hace : GET — listado de órdenes con búsqueda multi-campo.
 *            POST — creación de una nueva orden en borrador con sus líneas.
 * Responsabilidad : Autenticar sesión, parsear parámetros y delegar al repository.
 * No debe          : Contener lógica de negocio más allá de validación básica de campos.
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { fetchContainerInfoByOrderIds } from "@/modules/orders/repositories/orderContainerRepository";
import {
  listOrders,
  insertOrderHeader,
  insertOrderItems,
  deleteOrderById,
} from "@/modules/orders/repositories/ordersRepository";

// ─── GET /api/orders ──────────────────────────────────────────────────────────

/**
 * Devuelve la lista de órdenes de compra con filtros opcionales.
 *
 * Query params:
 * @param estado  - "ALL" | "borrador" | "confirmado" | "cancelado" | "recibido"
 * @param q       - Búsqueda en numero_orden, numero_pedido_agente, SKU y nombre de producto
 * @param puerto  - Filtro parcial por fob_puerto (ilike)
 * @param limit   - Máx. filas (default 200, máx. 500)
 */
export async function GET(req: Request) {
  const supabase = createSupabaseRouteClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const estado = searchParams.get("estado") ?? "ALL";
  const q      = (searchParams.get("q") ?? "").trim();
  const puerto = (searchParams.get("puerto") ?? "").trim();
  const limit  = Math.min(Number(searchParams.get("limit") ?? "200"), 500);

  try {
    // Si hay texto de búsqueda, se resuelven los IDs de órdenes que contienen
    // productos con ese SKU/nombre antes de construir la query principal.
    let extraOrderIds: string[] = [];
    if (q) {
      const { data: prodRows } = await supabase
        .from("productos")
        .select("id")
        .or(`sku.ilike.%${q}%,nombre.ilike.%${q}%`)
        .limit(200);

      const prodIds = (prodRows ?? []).map((r) => (r as { id: string }).id).filter(Boolean);

      if (prodIds.length > 0) {
        const { data: itemRows } = await supabase
          .from("orden_items")
          .select("orden_id")
          .in("producto_id", prodIds)
          .limit(5000);

        extraOrderIds = Array.from(
          new Set((itemRows ?? []).map((r) => (r as { orden_id: string }).orden_id).filter(Boolean)),
        );
      }
    }

    const rows = await listOrders({ estado, q, puerto, limit, extraOrderIds });
    const containerByOrder = await fetchContainerInfoByOrderIds(
      supabase,
      rows.map((row) => row.id),
    );
    const enrichedRows = rows.map((row) => ({
      ...row,
      contenedor: containerByOrder.get(row.id) ?? null,
    }));
    return NextResponse.json({ ok: true, rows: enrichedRows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error al listar pedidos.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ─── POST /api/orders ─────────────────────────────────────────────────────────

/**
 * Crea una nueva orden de compra en estado borrador con sus líneas de producto.
 *
 * Body esperado:
 * @param fob_puerto  - Puerto de salida FOB
 * @param destino     - Destino
 * @param fecha_orden - Fecha ISO 'YYYY-MM-DD'
 * @param cbm_limite  - Límite de cubicaje en m³
 * @param notas       - Notas opcionales
 * @param items       - Array de líneas { producto_id, proveedor_id, cantidad, cbm_unitario, ... }
 *
 * Si la inserción de ítems falla, se realiza rollback manual borrando la cabecera.
 */
export async function POST(req: Request) {
  const supabase = createSupabaseRouteClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: {
    fob_puerto?: string | null;
    destino?: string | null;
    fecha_orden?: string;
    cbm_limite?: number | null;
    agente_id?: string | null;
    notas?: string | null;
    items?: Array<{
      producto_id: string;
      proveedor_id?: string | null;
      cantidad: number;
      cbm_unitario?: number | null;
      coste_unitario_moneda?: number | null;
      coste_unitario_usd?: number | null;
      coste_unitario_eur?: number | null;
      lote_producto?: string | null;
    }>;
  };

  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const { items, ...cabecera } = body;

  try {
    // Insertar cabecera — el trigger genera numero_orden automáticamente
    const orden = await insertOrderHeader({
      estado: "borrador",
      fob_puerto: cabecera.fob_puerto ?? null,
      destino: cabecera.destino ?? null,
      fecha_orden: cabecera.fecha_orden ?? new Date().toISOString().slice(0, 10),
      cbm_limite: cabecera.cbm_limite ?? null,
      agente_id: cabecera.agente_id ?? null,
      notas: cabecera.notas ?? null,
      created_by: user.id,
    });

    // Insertar líneas con rollback manual si falla
    if (items && items.length > 0) {
      try {
        const { warnings } = await insertOrderItems(orden.id, items);
        const { data: ordenFull } = await supabase
          .from("ordenes_compra")
          .select("*")
          .eq("id", orden.id)
          .single();

        return NextResponse.json(
          { ok: true, orden: ordenFull, warnings },
          { status: 201 },
        );
      } catch (itemsErr) {
        await deleteOrderById(orden.id);
        const msg = itemsErr instanceof Error ? itemsErr.message : "Error en las líneas";
        return NextResponse.json({ ok: false, error: msg }, { status: 400 });
      }
    }

    // Re-leer cabecera para obtener totales calculados por trigger
    const { data: ordenFull } = await supabase
      .from("ordenes_compra")
      .select("*")
      .eq("id", orden.id)
      .single();

    return NextResponse.json({ ok: true, orden: ordenFull, warnings: [] }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error creando la orden.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
