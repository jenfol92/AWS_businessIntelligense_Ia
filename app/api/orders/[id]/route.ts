/**
 * Modulo   : orders
 * Archivo  : app/api/orders/[id]/route.ts
 * Que hace : GET devuelve una orden con sus lineas y nombre de producto.
 *            PUT actualiza cabecera y lineas de un borrador (estado=borrador).
 * No debe  : Confirmar ordenes (ver /[id]/confirm) ni gestionar stock.
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  getOrderWithItems,
  updateOrderDraft,
} from "@/modules/orders/repositories/ordersRepository";

type Params = { params: { id: string } };

/** GET /api/orders/[id] — cabecera + lineas con nombre de producto y proveedor */
export async function GET(_req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  try {
    const result = await getOrderWithItems(params.id);
    if (!result) {
      return NextResponse.json({ ok: false, error: "Orden no encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, orden: result.orden, items: result.items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error obteniendo la orden.";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * PUT /api/orders/[id] — actualiza cabecera y, opcionalmente, reemplaza todas las lineas.
 * Solo actua sobre ordenes en estado "borrador".
 * Body: { fob_puerto?, destino?, fecha_orden?, cbm_limite?, notas?, items? }
 */
export async function PUT(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

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
    moneda_compra?: string | null;
    tipo_cambio_moneda_eur?: number | null;
    tipo_cambio_usd_eur?: number | null;
    numero_pedido_agente?: string | null;
    lead_time_produccion?: number | null;
    lead_time_transito?: number | null;
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
    return NextResponse.json({ ok: false, error: "JSON invalido" }, { status: 400 });
  }

  const { items, tipo_envio, ...restHeader } = body;
  const header = {
    ...restHeader,
    ...(tipo_envio != null
      ? { tipo_envio: tipo_envio === "amazon_agl" ? "amazon_agl" as const : "propio" as const }
      : {}),
  };

  try {
    const { orden, warnings } = await updateOrderDraft(params.id, header, items);
    return NextResponse.json({ ok: true, orden, warnings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error actualizando la orden.";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
