/**
 * GET /api/inventory/lotes?producto_id=&pais=
 * Lotes de coste/stock desde producto_costos (no inventario_paises).
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { buildInventoryLotes } from "@/modules/inventory/services/buildInventoryLotes";

export async function GET(req: Request) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const url = new URL(req.url);
  const productoId = url.searchParams.get("producto_id")?.trim();

  if (!productoId) {
    return NextResponse.json(
      { ok: false, error: "producto_id requerido" },
      { status: 400 },
    );
  }

  try {
    const pais = url.searchParams.get("pais") ?? undefined;
    const result = await buildInventoryLotes(productoId, pais);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al cargar lotes";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
