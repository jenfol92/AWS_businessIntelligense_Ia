import { NextRequest, NextResponse } from "next/server";

import {
  compareInventoryMarketplaceSignatures,
  getSingleSkuInventoryMarketplaceSignature,
  safeSingleSkuDiagnosticError,
  type SingleSkuInventoryDiagnosticResult,
} from "@/modules/amazon-sp-api/fbaInventorySingleSkuDiagnostic";
import { spApiRequest } from "@/modules/amazon-sp-api/spApiClient";
import { persistInventorySummaryRequestTelemetry } from "@/modules/amazon-sp-api/inventorySummaryRequestTelemetry";

export const dynamic = "force-dynamic";

function unavailableInProduction() {
  return NextResponse.json({ ok: false, error: "Diagnostico no disponible en produccion." }, { status: 404 });
}

/** One invocation performs exactly one Amazon inventory-summary HTTP request. */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return unavailableInProduction();
  const marketplace = request.nextUrl.searchParams.get("marketplace") ?? "";
  const sellerSku = request.nextUrl.searchParams.get("sellerSku") ?? "";
  try {
    const result = await getSingleSkuInventoryMarketplaceSignature({
      marketplace,
      sellerSku,
      request: spApiRequest,
      persistTelemetry: persistInventorySummaryRequestTelemetry,
    });
    return NextResponse.json({ ok: result.status === "OK", result }, {
      status: result.status === "OK" ? 200 : 409,
    });
  } catch (error) {
    const safe = safeSingleSkuDiagnosticError(error);
    return NextResponse.json({ ok: false, error: safe }, { status: safe.httpStatus ?? 500 });
  }
}

/** Pure comparison: it never calls Amazon and never persists evidence. */
export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return unavailableInProduction();
  try {
    const body = await request.json() as { a?: SingleSkuInventoryDiagnosticResult; b?: SingleSkuInventoryDiagnosticResult };
    if (!body.a || !body.b) {
      return NextResponse.json({ ok: false, error: "Se requieren los resultados a y b." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, comparison: compareInventoryMarketplaceSignatures(body.a, body.b) });
  } catch {
    return NextResponse.json({ ok: false, error: "Payload de comparacion invalido." }, { status: 400 });
  }
}
