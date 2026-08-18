import { NextRequest, NextResponse } from "next/server";

import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { syncAmazonInventoryCanonical } from "@/modules/amazon-sp-api/amazonInventoryCanonicalSyncService";
import { supabaseAdmin } from "@/server/supabase/adminClient";

export const dynamic = "force-dynamic";
const INVENTORY_CRON_GATE_CODE = "INVENTORY_REFRESH_TEMPORARILY_GATED";

const JOB_KEY = "amazon_fba_inventory_snapshot";
const NEXT_RUN_HINT = "Cada 6 h inicialmente; ajustar a 4 h si hace falta.";

function getCronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}

async function updateSyncJob(params: {
  finishedAt: string;
  status: "SUCCESS" | "ERROR" | "RATE_LIMITED";
  error?: string | null;
  rowsUpserted?: number | null;
}) {
  const { error } = await supabaseAdmin
    .from("amazon_sync_jobs")
    .upsert(
      {
        job_key: JOB_KEY,
        last_run_at: params.finishedAt,
        last_success_at: params.status === "SUCCESS" ? params.finishedAt : undefined,
        last_status: params.status,
        last_error: params.error ?? null,
        last_rows_upserted: params.rowsUpserted ?? null,
        next_run_hint: NEXT_RUN_HINT,
        updated_at: params.finishedAt,
      },
      { onConflict: "job_key" },
    );

  if (error) {
    console.error("[amazon-fba-inventory-snapshot-cron] sync job update failed", {
      jobKey: JOB_KEY,
      error,
    });
  }
}

function isRateLimitError(mapped: ReturnType<typeof mapGenericError>): boolean {
  const message = mapped.message.toLowerCase();
  return (
    mapped.status === 429 ||
    mapped.code === "rate_limited" ||
    message.includes("quota") ||
    message.includes("too many requests")
  );
}

export async function POST(request: NextRequest) {
  const startedAt = new Date().toISOString();
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, status: "ERROR", error: "CRON_SECRET no configurado.", startedAt },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, status: "ERROR", error: "No autorizado.", startedAt },
      { status: 401 },
    );
  }

  return NextResponse.json(
    { ok: false, status: "GATED", code: INVENTORY_CRON_GATE_CODE, error: "Cron Inventory desactivado hasta validar Inventory Summaries filtrado.", startedAt },
    { status: 503 },
  );

  const missing = getMissingSpApiEnvKeys();
  if (missing.length > 0) {
    const finishedAt = new Date().toISOString();
    const error = `Faltan variables de entorno: ${missing.join(", ")}`;
    await updateSyncJob({
      finishedAt,
      status: "ERROR",
      error,
      rowsUpserted: null,
    });
    return NextResponse.json(
      { ok: false, status: "ERROR", error, startedAt, finishedAt },
      { status: 400 },
    );
  }

  try {
    const canonical = await syncAmazonInventoryCanonical();
    if (canonical.action !== "synced") {
      return NextResponse.json({ ok: true, status: canonical.action.toUpperCase(), ...canonical });
    }
    const summary = canonical.inventory!;
    const finishedAt = new Date().toISOString();
    await updateSyncJob({
      finishedAt,
      status: "SUCCESS",
      error: null,
      rowsUpserted: summary.rowsUpserted,
    });

    return NextResponse.json({
      ok: true,
      status: "SUCCESS",
      rowsParsed: summary.rowsParsed,
      rowsUpserted: summary.rowsUpserted,
      matchedRows: summary.matchedRows,
      unmatchedRows: summary.unmatchedRows,
      warnings: summary.warnings ?? [],
      startedAt,
      finishedAt,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    const finishedAt = new Date().toISOString();
    const rateLimited = isRateLimitError(mapped);
    const status = rateLimited ? "RATE_LIMITED" : "ERROR";
    const warnings = rateLimited
      ? ["Amazon SP-API rate limit/quota exceeded. Reintentar más tarde."]
      : [];

    await updateSyncJob({
      finishedAt,
      status,
      error: mapped.message,
      rowsUpserted: null,
    });

    return NextResponse.json(
      {
        ok: false,
        status,
        rowsParsed: 0,
        rowsUpserted: 0,
        matchedRows: 0,
        unmatchedRows: 0,
        warnings,
        error: mapped.message,
        startedAt,
        finishedAt,
      },
      { status: rateLimited ? 429 : (mapped.status ?? 500) },
    );
  }
}
