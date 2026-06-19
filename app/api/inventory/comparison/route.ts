/**
 * GET /api/inventory/comparison
 * Listado comparativo de inventario con filtros.
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { buildInventoryDashboard } from "@/modules/inventory/services/buildInventoryDashboard";
import type { InventoryComparisonParams } from "@/modules/inventory/types/inventory.types";

function parseBool(raw: string | null): boolean {
  return raw === "true" || raw === "1";
}

export async function GET(req: Request) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const params: InventoryComparisonParams = {
      q: url.searchParams.get("q") ?? undefined,
      categoria: url.searchParams.get("categoria") ?? undefined,
      proveedor: url.searchParams.get("proveedor") ?? undefined,
      canal: url.searchParams.get("canal") ?? undefined,
      soloCriticos: parseBool(url.searchParams.get("soloCriticos")),
      stockZero: parseBool(url.searchParams.get("stockZero")),
      sinHistorico: parseBool(url.searchParams.get("sinHistorico")),
      conInbound: parseBool(url.searchParams.get("conInbound")),
    };

    const result = await buildInventoryDashboard(params);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error al cargar inventario";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
