import { NextRequest, NextResponse } from "next/server";
import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { syncAmazonInventoryCanonical } from "@/modules/amazon-sp-api/amazonInventoryCanonicalSyncService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";
const INVENTORY_REFRESH_GATE_CODE = "INVENTORY_REFRESH_TEMPORARILY_GATED";

type Body = {
  marketplaceIds?: string[];
};

export async function POST(request: NextRequest) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  return NextResponse.json(
    { ok: false, code: INVENTORY_REFRESH_GATE_CODE, error: "Inventory Summaries permanece cerrado hasta validar el path filtrado single-SKU." },
    { status: 503 },
  );

  const missing = getMissingSpApiEnvKeys();
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Faltan variables de entorno: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    const summary = await syncAmazonInventoryCanonical({
      marketplaceIds: body.marketplaceIds,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, error: mapped.message, code: mapped.code },
      { status: mapped.status ?? 400 },
    );
  }
}
