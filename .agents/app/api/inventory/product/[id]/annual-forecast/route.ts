/**

 * GET /api/inventory/product/[id]/annual-forecast

 * Plan anual mensual por país/canal (año natural anterior como base).

 */



import { NextResponse } from "next/server";

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

import { buildAnnualInventoryForecast } from "@/modules/inventory/services/buildAnnualInventoryForecast";
import { parseForecastConfigOverrideFromSearchParams } from "@/modules/inventory/services/parseForecastConfigOverride";

import {

  fetchActiveProducts,

  fetchInboundByProductIds,

  fetchInventoryRows,

} from "@/modules/inventory/repositories/inventoryRepository";



type RouteContext = { params: { id: string } };



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

    const pais = url.searchParams.get("pais") ?? undefined;

    const canal = url.searchParams.get("canal") ?? undefined;

    const forecastOverride = parseForecastConfigOverrideFromSearchParams(
      url.searchParams,
    );



    const products = await fetchActiveProducts();

    const product = products.find((p) => p.id === params.id);

    if (!product) {

      return NextResponse.json(

        { ok: false, error: "Producto no encontrado" },

        { status: 404 },

      );

    }



    const [inventoryRows, inboundMap] = await Promise.all([

      fetchInventoryRows([product.id]),

      fetchInboundByProductIds([product.id]),

    ]);



    const annualForecast = await buildAnnualInventoryForecast(

      product,

      inventoryRows,

      inboundMap.get(product.id) ?? [],

      products,

      { pais, canal, forecastOverride },

    );



    return NextResponse.json({
      ok: true,
      annualForecast,
      simulationActive: forecastOverride != null,
      appliedForecastConfig: forecastOverride ?? undefined,
    });

  } catch (error) {

    const message =

      error instanceof Error ? error.message : "Error al calcular forecast anual";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });

  }

}

