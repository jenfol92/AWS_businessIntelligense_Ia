/**
 * Modulo   : orders
 * Archivo  : app/api/orders/[id]/reopen/route.ts
 * Que hace : POST — reabre una orden confirmada a estado borrador.
 *            Registra un anotacion en el campo notas con la fecha y motivo.
 * No debe  : Reabrir ordenes que no esten confirmadas ni gestionar contenedores.
 */

import { NextResponse } from "next/server";
import { reopenOrder } from "@/modules/orders/services/reopenOrder";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = { params: { id: string } };

/**
 * POST /api/orders/[id]/reopen
 *
 * Body (opcional):
 * @param motivo - Texto libre con el motivo de reapertura (se anexa a notas).
 *
 * Solo actua sobre ordenes en estado "confirmado". Si la orden no existe
 * o ya esta en borrador, devuelve 400.
 */
export async function POST(req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  let body: { motivo?: string } = {};
  try { body = await req.json(); } catch { body = {}; }

  const motivo = (body?.motivo ?? "").trim();

  try {
    const orden = await reopenOrder(params.id, motivo);
    return NextResponse.json({ ok: true, orden });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "No se pudo reabrir la orden.";
    const status = msg.includes("ADMIN_OR_ACCOUNTING_REQUIRED")
      ? 403
      : msg.includes("ORDER_NOT_FOUND") || msg.includes("no encontrada")
        ? 404
        : 400;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
