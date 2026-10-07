/**
 * Modulo   : orders
 * Archivo  : app/api/orders/fx-rate/route.ts
 * Que hace : GET — tipo de cambio de referencia del BCE para una moneda de compra,
 *            en la convención de la orden (1 EUR = X moneda).
 * No debe  : Persistir nada. El tipo se congela al confirmar la orden.
 */

import { NextResponse } from "next/server";
import { getLatestEcbFxTable } from "@/modules/finance/services/ecbFxService";
import { marketFxFromEcbTable, normalizeOrderCurrency } from "@/modules/orders/services/marketFxRate";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = createSupabaseRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  const currency = normalizeOrderCurrency(new URL(req.url).searchParams.get("currency"));
  if (!currency) return NextResponse.json({ ok: false, error: "Moneda no soportada" }, { status: 400 });
  if (currency === "EUR") {
    return NextResponse.json({ ok: true, rate: { currency, foreignPerEur: 1, referenceDate: null, source: "IDENTITY" } });
  }

  try {
    const rate = marketFxFromEcbTable(await getLatestEcbFxTable(), currency);
    if (!rate) return NextResponse.json({ ok: false, error: "El BCE no publica esta moneda" }, { status: 404 });
    return NextResponse.json({ ok: true, rate });
  } catch {
    return NextResponse.json({ ok: false, error: "Tipo de cambio del BCE no disponible" }, { status: 503 });
  }
}
