/**
 * Módulo   : containers
 * Archivo  : app/api/containers/[id]/facturar/route.ts
 * Qué hace : POST — Factura/cierre de costes del contenedor (reparto CBM → producto_costos).
 *            NO aplica stock ni modifica inventario_paises.
 */

import { NextResponse } from "next/server";
import { facturarContainerCosts } from "@/modules/containers/services/facturarContainerCosts";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = { params: { id: string } };

/** POST /api/containers/[id]/facturar */
export async function POST(_req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await facturarContainerCosts(params.id, user.id);

    if (result.ok === false) {
      return NextResponse.json(
        {
          ok: false,
          code: result.code,
          error: result.message,
          details: result.details ?? [],
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error al facturar contenedor";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
