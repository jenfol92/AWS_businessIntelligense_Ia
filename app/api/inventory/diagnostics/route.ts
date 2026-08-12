import { NextRequest, NextResponse } from "next/server";

import { buildInventoryDiagnostics } from "@/modules/inventory/services/buildInventoryDiagnostics";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

function parseBool(raw: string | null): boolean {
  return raw === "true" || raw === "1";
}

function parseLimit(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export async function GET(request: NextRequest) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const result = await buildInventoryDiagnostics({
      productId: url.searchParams.get("productId"),
      limit: parseLimit(url.searchParams.get("limit")),
      q: url.searchParams.get("q"),
      onlyMissing: parseBool(url.searchParams.get("onlyMissing")),
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Error generando diagnóstico de inventario";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
