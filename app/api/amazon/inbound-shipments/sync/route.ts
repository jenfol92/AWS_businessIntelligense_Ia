/** Sincronizacion manual del workflow independiente Inbound Shipments. */
import { NextRequest, NextResponse } from "next/server";

import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { syncInboundShipmentsToAmazonEnvios } from "@/modules/amazon-sp-api/syncInboundShipmentsToAmazonEnviosService";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type SyncBody = {
  limit?: number | string;
  fromDate?: string;
  lastUpdatedAfter?: string;
  toDate?: string;
  year?: number | string;
  includeClosed?: boolean | string;
  includeClosedCurrentYear?: boolean | string;
  includeReadyToShip?: boolean | string;
};

function boolFrom(value: unknown): boolean {
  return value === true || String(value ?? "").toLowerCase() === "true";
}

function parseLimit(request: NextRequest, body: SyncBody): number {
  const raw = Number(body.limit ?? request.nextUrl.searchParams.get("limit") ?? 25);
  return Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 1), 100) : 25;
}

function parseYear(request: NextRequest, body: SyncBody): number | null {
  const raw = Number(body.year ?? request.nextUrl.searchParams.get("year"));
  return Number.isInteger(raw) ? raw : null;
}

export async function POST(request: NextRequest) {
  const supabase = createSupabaseRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });

  const missing = getMissingSpApiEnvKeys();
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Faltan variables de entorno: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const body = ((await request.json().catch(() => ({}))) ?? {}) as SyncBody;
    const includeClosedCurrentYear = boolFrom(
      body.includeClosedCurrentYear ?? request.nextUrl.searchParams.get("includeClosedCurrentYear"),
    );
    const includeClosed = includeClosedCurrentYear || boolFrom(
      body.includeClosed ?? request.nextUrl.searchParams.get("includeClosed"),
    );
    const includeReadyToShip = body.includeReadyToShip == null &&
      request.nextUrl.searchParams.get("includeReadyToShip") == null
      ? true
      : boolFrom(body.includeReadyToShip ?? request.nextUrl.searchParams.get("includeReadyToShip"));

    const summary = await syncInboundShipmentsToAmazonEnvios({
      userId: user.id,
      limit: parseLimit(request, body),
      fromDate: body.fromDate ?? body.lastUpdatedAfter ??
        request.nextUrl.searchParams.get("fromDate") ??
        request.nextUrl.searchParams.get("lastUpdatedAfter"),
      toDate: body.toDate ?? request.nextUrl.searchParams.get("toDate"),
      year: parseYear(request, body),
      includeClosed,
      includeClosedCurrentYear,
      includeReadyToShip,
    });

    return NextResponse.json({ ok: true, summary, warnings: summary.warnings, errors: summary.errors });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, error: mapped.message, code: mapped.code },
      { status: mapped.status ?? 400 },
    );
  }
}
