/**
 * GET /api/inventory/product/[id]/forecast
 *
 * Forecast de inventario para un producto seleccionado.
 * Se carga por separado del detalle operativo para no bloquear
 * stock, ventas, KPIs e inbound.
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

import { buildProductInventoryForecast } from "@/modules/inventory/services/buildProductInventoryForecast";
import { parseForecastConfigOverrideFromSearchParams } from "@/modules/inventory/services/parseForecastConfigOverride";

type RouteContext = { params: { id: string } };

function parseWindowDays(raw: string | null): number {
  const n = Number(raw ?? 30);

  if (!Number.isFinite(n) || n < 1) {
    return 30;
  }

  return Math.min(Math.round(n), 365);
}

export async function GET(
  req: Request,
  { params }: RouteContext,
) {
  const supabase = createSupabaseRouteClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json(
      {
        ok: false,
        error: "No autorizado",
      },
      {
        status: 401,
      },
    );
  }

  try {
    const url = new URL(req.url);

    const forecastOverride =
      parseForecastConfigOverrideFromSearchParams(
        url.searchParams,
      );

      console.log("[forecast abort debug] START", {
        productId: params.id,
        aborted: req.signal.aborted,
      });
      
      req.signal.addEventListener(
        "abort",
        () => {
          console.log("[forecast abort debug] ABORT", {
            productId: params.id,
            aborted: req.signal.aborted,
          });
        },
        { once: true },
      );
      
    const result = await buildProductInventoryForecast(
      params.id,
      {
        canal:
          url.searchParams.get("canal") ?? undefined,

        pais:
          url.searchParams.get("pais") ?? undefined,

        windowDays: parseWindowDays(
          url.searchParams.get("windowDays"),
        ),

        periodFrom:
          url.searchParams.get("periodFrom") ??
          undefined,

        periodTo:
          url.searchParams.get("periodTo") ??
          undefined,

        forecastOverride,

        debugStockout:
          url.searchParams.get("debugStockout") === "1",

        signal: req.signal,
        
      },
    );
      console.log("[forecast abort debug] END", {
        productId: params.id,
        aborted: req.signal.aborted,
      });

    if (!result) {
      return NextResponse.json(
        {
          ok: false,
          error: "Producto no encontrado",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error al cargar forecast";

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}