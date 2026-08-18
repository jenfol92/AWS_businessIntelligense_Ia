import { NextRequest, NextResponse } from "next/server";
import { getAmazonCanonicalInventory } from "@/modules/inventory/services/amazonCanonicalInventoryReadModel";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = createSupabaseRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  try {
    const p = request.nextUrl.searchParams;
    const result = await getAmazonCanonicalInventory({
      productId: p.get("productId") ?? undefined,
      asin: p.get("asin") ?? undefined,
      operationalPool: p.get("pool") === "EU" || p.get("pool") === "UK"
        ? p.get("pool") as "EU" | "UK"
        : undefined,
      limit: Number(p.get("limit") ?? 2_000),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Error leyendo inventario Amazon" }, { status: 500 });
  }
}
