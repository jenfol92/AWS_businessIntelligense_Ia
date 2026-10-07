import { NextRequest, NextResponse } from "next/server";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { coordinateFbmSync, fbmJobResult } from "@/modules/amazon-sp-api/fbmSyncCoordinator";
import { findOrCreateFbmJob } from "@/modules/amazon-sp-api/fbmSyncRepository";
import { fbmHttpStatus, fbmManualEnabled } from "@/modules/amazon-sp-api/fbmSyncPolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** UI observation only. Closing the browser never stops the server-side recovery. */
export async function GET(request: NextRequest) {
  const { data: { user } } = await createSupabaseRouteClient().auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autenticado." }, { status: 401 });
  const jobId = request.nextUrl.searchParams.get("jobId") ?? undefined;
  if (jobId && !/^[a-f0-9-]{36}$/i.test(jobId)) return NextResponse.json({ error: "jobId inválido." }, { status: 400 });
  try {
    const job = await findOrCreateFbmJob({ jobId, recoveryOnly: true });
    return NextResponse.json(job ? fbmJobResult(job) : null, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudo consultar el trabajo FBM." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const { data: { user } } = await createSupabaseRouteClient().auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autenticado." }, { status: 401 });
  if (!fbmManualEnabled()) return NextResponse.json({ ok: false, error: "FBM manual deshabilitado por configuración." }, { status: 503 });
  const parsed = await request.json().catch(() => ({}));
  const body = parsed && typeof parsed === "object" ? parsed : {};
  if ([body.jobId, body.retryAfterJobId].some(value => value !== undefined && (typeof value !== "string" || !/^[a-f0-9-]{36}$/i.test(value)))) {
    return NextResponse.json({ ok: false, error: "jobId inválido." }, { status: 400 });
  }
  try {
    const result = await coordinateFbmSync({ jobId: body.jobId, retryAfterJobId: body.retryAfterJobId });
    return NextResponse.json(result, { status: result ? fbmHttpStatus(result.status) : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "No se pudo avanzar FBM. El trabajo persistido se conserva." }, { status: 503 });
  }
}
