/**
 * app/api/cron/policies-compliance/route.ts
 *
 * Scheduled cron job: runs syncWithAmazon() every 24 hours.
 *
 * Trigger via:
 *   GET  /api/cron/policies-compliance
 *   POST /api/cron/policies-compliance
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 *
 * Guardrail §3: one canonical sync service, no concurrent runs
 * (idempotency is ensured by updateAlertSyncState using last_checked_at).
 *
 * Recommended Vercel/Next.js cron config (vercel.json):
 *   { "crons": [{ "path": "/api/cron/policies-compliance", "schedule": "0 6 * * *" }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { syncWithAmazon } from "@/modules/policies-compliance/services/policyComplianceService";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  return (
    Boolean(secret) &&
    request.headers.get("authorization")?.trim() === `Bearer ${secret}`
  );
}

async function run(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }

  try {
    const startedAt = new Date().toISOString();
    const result = await syncWithAmazon();
    return NextResponse.json({
      ok: true,
      job: "policies-compliance-sync",
      startedAt,
      completedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        job: "policies-compliance-sync",
        error: error instanceof Error ? error.message : "CRON_SYNC_FAILED",
      },
      { status: 503 },
    );
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
