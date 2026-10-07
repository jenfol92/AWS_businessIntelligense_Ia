import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { findProductMarketplaces } from "@/modules/products/repositories/productMarketplacesRepository";
import { diagnoseProductListingIssues } from "@/modules/amazon-sp-api/listingIssuesDiagnostic";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const respond = (body: unknown, status = 200) => NextResponse.json(body, {
    status, headers: { "Cache-Control": "no-store" },
  });
  // Preserve the established DEV-only SP-API diagnostic boundary.
  if (process.env.NODE_ENV === "production") {
    return respond({ ok: false, error: "Diagnostico no disponible en produccion." }, 404);
  }
  try {
    const db = createSupabaseRouteClient();
    const { data: { session } } = await db.auth.getSession();
    if (!session) return respond({ ok: false, error: "No autorizado." }, 401);
    const result = await diagnoseProductListingIssues({
      productoId: request.nextUrl.searchParams.get("productoId") ?? "",
      marketplaceId: request.nextUrl.searchParams.get("marketplaceId") ?? "",
    }, { db, loadProductMarketplaces: findProductMarketplaces });
    return respond(result, "amazonObservation" in result ? 200 : 400);
  } catch {
    // No upstream body, SQL diagnostics, headers or credentials in the response/log.
    return respond({ ok: false, error: "LISTING_ISSUES_DIAGNOSTIC_FAILED" }, 500);
  }
}
