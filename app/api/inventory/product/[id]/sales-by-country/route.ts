/**
 * GET /api/inventory/product/[id]/sales-by-country?fromDate=&toDate=&canal=&pais=
 * Ventas del producto por país de marketplace en el periodo (modal de ventas).
 */

import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  SalesPeriodError,
  buildProductSalesByCountry,
  validateSalesPeriod,
} from "@/modules/inventory/services/buildProductSalesByCountry";

export const dynamic = "force-dynamic";

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
    const period = validateSalesPeriod(
      url.searchParams.get("fromDate"),
      url.searchParams.get("toDate"),
    );
    const result = await buildProductSalesByCountry(params.id, {
      ...period,
      canal: url.searchParams.get("canal"),
      pais: url.searchParams.get("pais"),
      signal: req.signal,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SalesPeriodError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : "Error cargando ventas por país";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
