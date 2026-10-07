/**
 * POST /api/amazon/reports/all-orders/import
 * Body: { fromDate, toDate } para iniciar, o { jobId } para reanudar.
 * Pedidos Amazon por fecha de compra (FBA+FBM, incluidos pendientes) → amazon_order_items.
 * Respuesta 202 mientras Amazon genera el informe; 200 al completar.
 */

import { NextRequest, NextResponse } from "next/server";
import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import {
  resumeAllOrdersSync,
  startAllOrdersSync,
} from "@/modules/amazon-sp-api/allOrdersSalesSyncService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;


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
    const body = (await request.json().catch(() => ({}))) as {
      jobId?: string;
      fromDate?: string;
      toDate?: string;
    };

    let result;
    if (typeof body.jobId === "string" && body.jobId) {
      if (body.fromDate || body.toDate) throw new Error("Use jobId para recovery o fromDate/toDate para generar, no ambos.");
      result = await resumeAllOrdersSync(body.jobId);
    } else {
      result = await startAllOrdersSync({
            fromDate: String(body.fromDate ?? ""),
            toDate: String(body.toDate ?? ""),
          });
    }

    const status = result.status === "COMPLETED" ? 200 : result.status === "PENDING" ? 202 : 422;
    return NextResponse.json(result, { status });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("ALL_ORDERS_RANGE_CONFLICT")) return NextResponse.json({ ok: false, code: "ALL_ORDERS_RANGE_CONFLICT", error: error.message }, { status: 409 });
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, error: mapped.message, code: mapped.code },
      { status: mapped.status ?? 400 },
    );
  }
}
