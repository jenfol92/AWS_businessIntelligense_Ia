/**
 * Módulo   : containers
 * Archivo  : app/api/containers/[id]/aplicar-stock/route.ts
 * Qué hace : POST — Aplica stock idempotente (contenedores propios con destinos definidos).
 */

import { NextResponse } from "next/server";
import { applyContainerStock } from "@/modules/containers/services/applyContainerStock";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type Params = { params: { id: string } };

export async function POST(_req: Request, { params }: Params) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const result = await applyContainerStock(params.id, {
      userId: user.id,
      includeCostPreview: true,
    });

    if (result.reason === "container_not_found") {
      return NextResponse.json({ ok: false, error: "Contenedor no encontrado" }, { status: 404 });
    }

    if (
      result.reason === "missing_stock_destinations" ||
      result.reason === "invalid_stock_destinations" ||
      result.reason === "unknown_container_type" ||
      result.reason === "no_order_items" ||
      result.reason === "stock_rpc_failed"
    ) {
      return NextResponse.json(
        {
          ok: false,
          reason: result.reason,
          warnings: result.warnings,
          costAllocation: result.costAllocation,
        },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      applied: result.applied,
      reason: result.reason,
      summary: result.summary,
      warnings: result.warnings,
      costAllocation: result.costAllocation,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error aplicando stock";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
