import { NextRequest, NextResponse } from "next/server";
import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { buildVendorShipmentDetailsDiagnostic } from "@/modules/amazon-sp-api/vendorShipmentDetailsDiagnosticService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type Body = {
  shipmentId?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
};

function isOptionalDate(value: unknown): value is string | undefined {
  return value == null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function POST(request: NextRequest) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const missing = getMissingSpApiEnvKeys();
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Faltan variables de entorno: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Body;
    if (!isOptionalDate(body.fromDate) || !isOptionalDate(body.toDate)) {
      return NextResponse.json(
        { ok: false, error: "fromDate/toDate deben usar formato YYYY-MM-DD." },
        { status: 400 },
      );
    }

    const diagnostic = await buildVendorShipmentDetailsDiagnostic({
      shipmentId: body.shipmentId,
      fromDate: body.fromDate,
      toDate: body.toDate,
      limit: body.limit,
    });

    return NextResponse.json(diagnostic);
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, error: mapped.message, code: mapped.code, details: mapped.details },
      { status: mapped.status ?? 400 },
    );
  }
}
