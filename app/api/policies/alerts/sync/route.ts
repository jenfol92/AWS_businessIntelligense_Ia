/**
 * app/api/policies/alerts/sync/route.ts
 *
 * POST /api/policies/alerts/sync
 *   Triggers a manual synchronization cycle against Amazon SP-API.
 *   Checks all active alerts and marks resolved those Amazon no longer reports.
 *
 * Auth: CRON_SECRET or authenticated session.
 * This endpoint is also called by the cron route for scheduled runs.
 */

import { NextRequest, NextResponse } from "next/server";
import { syncWithAmazon } from "@/modules/policies-compliance/services/policyComplianceService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorizedByCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  return (
    Boolean(secret) &&
    request.headers.get("authorization")?.trim() === `Bearer ${secret}`
  );
}

export async function POST(request: NextRequest) {
  if (!authorizedByCronSecret(request)) {
    const supabase = createSupabaseRouteClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
    }
  }

  try {
    const startedAt = new Date().toISOString();
    const result = await syncWithAmazon();
    return NextResponse.json({
      ok: true,
      startedAt,
      completedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "POLICY_SYNC_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
