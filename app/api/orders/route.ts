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
import {
  fetchAmazonInboundInfoByOrderIds,
  fetchContainerInfoByOrderIds,
} from "@/modules/orders/repositories/orderContainerRepository";
import {
  listOrders,
  insertOrderHeader,
  insertOrderItems,
  deleteOrderById,
} from "@/modules/orders/repositories/ordersRepository";

function dateInRange(value: string | null | undefined, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!value) return false;
  const day = value.slice(0, 10);
  if (from && day < from.slice(0, 10)) return false;
  if (to && day > to.slice(0, 10)) return false;
  return true;
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ─── GET /api/orders ──────────────────────────────────────────────────────────

/**
 * Devuelve la lista de órdenes de compra con filtros opcionales.
 *
 * Query params:
 * @param estado  - "ALL" | "borrador" | "confirmado" | "cancelado" | "recibido"
 * @param q       - Búsqueda en numero_orden, numero_pedido_agente, SKU y nombre de producto
 * @param createdFrom/createdTo - Rango por fecha de creacion.
 * @param etdFrom/etdTo         - Rango por fecha de salida logistica.
 * @param etaFrom/etaTo         - Rango por ETA logistica.
 * @param limit   - Máx. filas (default 200, máx. 500)
 */
export async function GET(req: Request) {
  const supabase = createSupabaseRouteClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const estado      = searchParams.get("estado") ?? "ALL";
  const q           = (searchParams.get("q") ?? "").trim();
  const createdFrom = (searchParams.get("createdFrom") ?? "").trim();
  const createdTo   = (searchParams.get("createdTo") ?? "").trim();
  const etdFrom     = (searchParams.get("etdFrom") ?? "").trim();
  const etdTo       = (searchParams.get("etdTo") ?? "").trim();
  const etaFrom     = (searchParams.get("etaFrom") ?? "").trim();
  const etaTo       = (searchParams.get("etaTo") ?? "").trim();
  const limit       = Math.min(Number(searchParams.get("limit") ?? "200"), 500);

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

    const rows = await listOrders({ estado, q, createdFrom, createdTo, limit, extraOrderIds });
    const orderIds = rows.map((row) => row.id);
    const [containerByOrder, amazonInboundByOrder, orderItemsResult] = await Promise.all([
      fetchContainerInfoByOrderIds(supabase, orderIds),
      fetchAmazonInboundInfoByOrderIds(supabase, orderIds),
      orderIds.length > 0
        ? supabase
            .from("orden_items")
            .select("orden_id, cantidad, coste_unitario_moneda")
            .in("orden_id", orderIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (orderItemsResult.error) throw new Error(orderItemsResult.error.message);
    const totalOriginalByOrder = new Map<string, number>();
    for (const item of orderItemsResult.data ?? []) {
      const orderId = String((item as { orden_id: string }).orden_id);
      const lineTotal =
        asNumber((item as { cantidad: unknown }).cantidad) *
        asNumber((item as { coste_unitario_moneda: unknown }).coste_unitario_moneda);
      totalOriginalByOrder.set(orderId, (totalOriginalByOrder.get(orderId) ?? 0) + lineTotal);
    }

    const enrichedRows = rows.map((row) => ({
      ...row,
      coste_total_moneda: totalOriginalByOrder.get(row.id) ?? null,
      contenedor: containerByOrder.get(row.id) ?? null,
      amazon_inbound: amazonInboundByOrder.get(row.id) ?? null,
    })).filter((row) => {
      if (
        process.env.NODE_ENV === "development"
        && row.tipo_envio === "amazon_agl"
        && !row.amazon_inbound
      ) {
        console.warn("[pedidos] amazon_agl sin assignment activo", {
          orderId: row.id,
          numeroOrden: row.numero_orden,
        });
      }

      const logisticsEtd =
        row.contenedor?.fecha_salida ?? row.amazon_inbound?.fecha_salida ?? row.etd ?? null;
      const logisticsEta =
        row.contenedor?.fecha_eta_estimada ?? row.amazon_inbound?.eta_estimada ?? row.eta ?? null;

      return dateInRange(logisticsEtd, etdFrom, etdTo)
        && dateInRange(logisticsEta, etaFrom, etaTo);
    });
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
    tipo_envio?: "propio" | "amazon_agl" | null;
    fob_puerto?: string | null;
    destino?: string | null;
    fecha_orden?: string;
    cbm_limite?: number | null;
    agente_id?: string | null;
    notas?: string | null;
    etd?: string | null;
    eta?: string | null;
    lead_time_produccion?: number | null;
    lead_time_transito?: number | null;
    moneda_compra?: string | null;
    tipo_cambio_moneda_eur?: number | null;
    tipo_cambio_usd_eur?: number | null;
    numero_pedido_agente?: string | null;
    items?: Array<{
      producto_id: string;
      proveedor_id?: string | null;
      cantidad: number;
      cbm_unitario?: number | null;
      coste_unitario_moneda?: number | null;
      coste_unitario_usd?: number | null;
      coste_unitario_eur?: number | null;
      moneda_coste?: string | null;
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
      tipo_envio: cabecera.tipo_envio === "amazon_agl" ? "amazon_agl" : "propio",
      fob_puerto: cabecera.fob_puerto ?? null,
      destino: cabecera.destino ?? null,
      fecha_orden: cabecera.fecha_orden ?? new Date().toISOString().slice(0, 10),
      cbm_limite: cabecera.cbm_limite ?? null,
      agente_id: cabecera.agente_id ?? null,
      notas: cabecera.notas ?? null,
      etd: cabecera.etd ?? null,
      eta: cabecera.eta ?? null,
      lead_time_produccion: cabecera.lead_time_produccion ?? null,
      lead_time_transito: cabecera.lead_time_transito ?? null,
      moneda_compra: cabecera.moneda_compra ?? null,
      tipo_cambio_moneda_eur: cabecera.tipo_cambio_moneda_eur ?? null,
      tipo_cambio_usd_eur: cabecera.tipo_cambio_usd_eur ?? null,
      numero_pedido_agente: cabecera.numero_pedido_agente ?? null,
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
