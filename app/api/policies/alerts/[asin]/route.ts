/**
 * app/api/policies/alerts/[asin]/route.ts
 *
 * GET /api/policies/alerts/:asin
 *   Returns all policy alerts for a specific ASIN, grouped by marketplace.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAlertsByAsin } from "@/modules/policies-compliance/services/policyComplianceService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: { asin: string } },
) {
  const supabase = createSupabaseRouteClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }

  const asin = params.asin?.trim().toUpperCase();
  if (!asin || !/^[A-Z0-9]{10}$/.test(asin)) {
    return NextResponse.json({ ok: false, error: "ASIN inválido." }, { status: 400 });
  }

  try {
    const grouped = await getAlertsByAsin(asin);
    return NextResponse.json({ ok: true, asin, data: grouped });
  } catch (error) {
    const message = error instanceof Error ? error.message : "POLICY_ALERTS_BY_ASIN_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
