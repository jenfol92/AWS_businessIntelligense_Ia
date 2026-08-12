import { NextResponse } from "next/server";

import { fetchCountryPriceDistribution } from "@/modules/inventory/repositories/inventoryRepository";
import type { InventoryCountryPriceChannel } from "@/modules/inventory/types/inventory.types";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

type RouteContext = { params: { productId: string } };

function parseChannel(raw: string | null): InventoryCountryPriceChannel {
  const value = String(raw ?? "ALL").trim().toUpperCase();
  if (value === "FBA" || value === "AMAZON_FBA") return "FBA";
  if (value === "FBM" || value === "AMAZON_FBM") return "FBM";
  return "ALL";
}

function parseWindowDays(raw: string | null): 30 | 90 {
  return raw === "90" ? 90 : 30;
}

function parseDate(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const value = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
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
    const country = url.searchParams.get("country")?.trim();
    const channel = parseChannel(url.searchParams.get("channel"));
    const windowDays = parseWindowDays(url.searchParams.get("windowDays"));
    const fromDate = parseDate(url.searchParams.get("fromDate"));
    const toDate = parseDate(url.searchParams.get("toDate"));

    if (!country) {
      return NextResponse.json(
        { ok: false, error: "country requerido" },
        { status: 400 },
      );
    }

    const rows = await fetchCountryPriceDistribution({
      productId: params.productId,
      country,
      channelScope: channel,
      windowDays,
      fromDate,
      toDate,
      limit: 20,
    });

    return NextResponse.json({
      ok: true,
      productId: params.productId,
      productIds: [params.productId],
      country,
      channel,
      windowDays,
      fromDate,
      toDate,
      rows,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error cargando distribucion de precios";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
