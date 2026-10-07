/**
 * GET /api/inventory/product/[id]/sales-by-country/[country]?fromDate=&toDate=
 * Detalle de ventas de un país: distribución de precios y líneas de venta.
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  SalesPeriodError,
  buildProductSalesCountryDetail,
  validateSalesPeriod,
} from "@/modules/inventory/services/buildProductSalesByCountry";

export const dynamic = "force-dynamic";

type RouteContext = { params: { id: string; country: string } };

export async function GET(req: Request, { params }: RouteContext) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const country = decodeURIComponent(params.country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ ok: false, error: "País no válido" }, { status: 400 });
  }

  try {
    const url = new URL(req.url);
    const period = validateSalesPeriod(
      url.searchParams.get("fromDate"),
      url.searchParams.get("toDate"),
    );
    const result = await buildProductSalesCountryDetail(params.id, country, {
      ...period,
      canal: url.searchParams.get("canal"),
      signal: req.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesPeriodError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Error cargando detalle de ventas";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
