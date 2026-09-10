/**

 * GET /api/inventory/product/[id]

 * Detalle de inventario para un producto seleccionado.

 */



import { NextResponse } from "next/server";

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

import { buildProductInventoryDetail } from "@/modules/inventory/services/buildProductInventoryDetail";
import { parseForecastConfigOverrideFromSearchParams } from "@/modules/inventory/services/parseForecastConfigOverride";



type RouteContext = { params: { id: string } };



function parseWindowDays(raw: string | null): number {

  const n = Number(raw ?? 30);

  if (!Number.isFinite(n) || n < 1) return 30;

  return Math.min(Math.round(n), 365);

}



export async function GET(req: Request, { params }: RouteContext) {

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
    const forecastOverride = parseForecastConfigOverrideFromSearchParams(
      url.searchParams,
    );

    const result = await buildProductInventoryDetail(params.id, {
      canal: url.searchParams.get("canal") ?? undefined,
      pais: url.searchParams.get("pais") ?? undefined,
      windowDays: parseWindowDays(url.searchParams.get("windowDays")),
      periodFrom: url.searchParams.get("periodFrom") ?? undefined,
      periodTo: url.searchParams.get("periodTo") ?? undefined,
      forecastOverride,
      debugStockout: url.searchParams.get("debugStockout") === "1",
      signal: req.signal,
    });



    if (!result) {

      return NextResponse.json(

        { ok: false, error: "Producto no encontrado" },

        { status: 404 },

      );

    }



    return NextResponse.json(result);

  } catch (error) {

    const message =

      error instanceof Error ? error.message : "Error al cargar detalle";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });

  }

}

