/**
 * app/api/policies/alerts/route.ts
 *
 * GET /api/policies/alerts
 *   Returns all policy alerts grouped by (asin, sku, category, type).
 *
 * POST /api/policies/alerts
 *   Receives a raw SP-API notification event and registers it.
 *   Body: { event: PolicyIssueEvent }
 *
 * Network boundary: Next.js BFF → service → Supabase/SP-API (§BFF guardrail).
 * Authentication: requires a valid Supabase session (authenticated user).
 */

import { NextRequest, NextResponse } from "next/server";
import { getAllGrouped, registerAlert } from "@/modules/policies-compliance/services/policyComplianceService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

async function assertAuthenticated(request: NextRequest): Promise<boolean> {
  const supabase = createSupabaseRouteClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session != null;
}

export async function GET(request: NextRequest) {
  if (!(await assertAuthenticated(request))) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }

  try {
    const grouped = await getAllGrouped();
    return NextResponse.json({ ok: true, data: grouped });
  } catch (error) {
    const message = error instanceof Error ? error.message : "POLICY_ALERTS_READ_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // Notification ingestion endpoint.
  // Secured by CRON_SECRET to allow SP-API notification webhook forwarding from
  // a verified intermediary server. Alternatively accept authenticated user calls.
  const secret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization")?.trim();
  const isAuthorizedByCronSecret =
    Boolean(secret) && authHeader === `Bearer ${secret}`;

  if (!isAuthorizedByCronSecret) {
    // Fall back to session auth for manual testing
    if (!(await assertAuthenticated(request))) {
      return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Cuerpo JSON inválido." }, { status: 400 });
  }

  const event =
    typeof body === "object" && body !== null && "event" in (body as object)
      ? (body as { event: unknown }).event
      : body;

  try {
    const saved = await registerAlert(event);
    return NextResponse.json({ ok: true, data: { registered: saved.length, alerts: saved } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "REGISTER_ALERT_FAILED";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
