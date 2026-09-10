import { NextRequest, NextResponse } from "next/server";

import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { buildCanonicalSalesMarketplaceScope } from "@/modules/amazon-sp-api/marketplaceMapping";
import { supabaseAdmin } from "@/server/supabase/adminClient";

export const dynamic = "force-dynamic";

const DEFAULT_SOURCE = "spapi_fba_customer_shipment_sales";
const DEFAULT_TIPO_CLIENTE = "B2C";
const JOB_KEY = "amazon_fba_sales_to_ventas_diarias";
const MAX_RANGE_DAYS = 31;

type Body = {
  startDate?: unknown;
  endDate?: unknown;
  marketplaceIds?: unknown;
  source?: unknown;
  tipoCliente?: unknown;
  mode?: unknown;
};

type SyncResult = {
  deleted?: number;
  inserted?: number;
  units?: number;
  orphanRows?: number;
  orphanUnits?: number;
  skippedSourceConflicts?: number;
  marketplaces?: string[];
  orphanMarketplaces?: string[];
  orphanCountries?: string[];
};

function getCronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}

function parseMarketplaceEnv(): string[] {
  const explicitList = process.env.AMAZON_SP_API_MARKETPLACE_IDS ?? "";

  const fromList = explicitList
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const [, marketplaceId] = value.includes(":") ? value.split(":") : ["", value];
      return marketplaceId.trim();
    });

  const fromIndividualVars = [
    process.env.AMAZON_MARKETPLACE_ES,
    process.env.AMAZON_MARKETPLACE_FR,
    process.env.AMAZON_MARKETPLACE_DE,
    process.env.AMAZON_MARKETPLACE_IT,
    process.env.AMAZON_MARKETPLACE_GB,
    process.env.AMAZON_MARKETPLACE_PL,
    process.env.AMAZON_MARKETPLACE_SE,
    process.env.AMAZON_MARKETPLACE_NL,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set([...fromList, ...fromIndividualVars])).sort();
}
function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toUtcDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getDefaultRange(): { startDate: string; endDate: string } {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterdayUtc = new Date(todayUtc);
  yesterdayUtc.setUTCDate(todayUtc.getUTCDate() - 1);
  return {
    startDate: toUtcDateOnly(yesterdayUtc),
    endDate: toUtcDateOnly(todayUtc),
  };
}

function daysBetween(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  return Math.round((end - start) / 86_400_000);
}

async function readBody(request: NextRequest): Promise<Body> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" ? (parsed as Body) : {};
}

function normalizeMarketplaceIds(value: unknown): string[] | null {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    throw new Error("marketplaceIds debe ser un array de strings.");
  }
  return Array.from(
    new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean),
    ),
  );
}

async function loadMarketplaceIdsFromView(params: {
  startDate: string;
  endDate: string;
}): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("v_amazon_fba_sales_daily")
    .select("marketplace_id")
    .gte("fecha", params.startDate)
    .lt("fecha", params.endDate)
    .neq("unidades_vendidas", 0);

  if (error) throw new Error(error.message);

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => String((row as { marketplace_id?: string | null }).marketplace_id ?? "").trim())
        .filter(Boolean),
    ),
  ).sort();
}

async function updateSyncJob(params: {
  finishedAt: string;
  status: "SUCCESS" | "ERROR";
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
        next_run_hint: "Ejecutar tras importar ventas FBA SP-API en raw.",
        updated_at: params.finishedAt,
      },
      { onConflict: "job_key" },
    );

  if (error) {
    console.error("[amazon-fba-sales-to-ventas-diarias] sync job update failed", {
      jobKey: JOB_KEY,
      error,
    });
  }
}

export async function POST(request: NextRequest) {
  const startedAt = new Date().toISOString();
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, mode: "syncOnly", error: "CRON_SECRET no configurado.", startedAt },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, mode: "syncOnly", error: "No autorizado.", startedAt },
      { status: 401 },
    );
  }

  try {
    const body = await readBody(request);
    const defaults = getDefaultRange();
    const startDate = body.startDate == null ? defaults.startDate : body.startDate;
    const endDate = body.endDate == null ? defaults.endDate : body.endDate;
    const source =
      typeof body.source === "string" && body.source.trim() ? body.source.trim() : DEFAULT_SOURCE;
    const tipoCliente =
      typeof body.tipoCliente === "string" && body.tipoCliente.trim()
        ? body.tipoCliente.trim()
        : DEFAULT_TIPO_CLIENTE;
    const mode = typeof body.mode === "string" && body.mode.trim() ? body.mode.trim() : "syncOnly";

    if (!isDateOnly(startDate) || !isDateOnly(endDate)) {
      return NextResponse.json(
        { ok: false, mode, error: "startDate y endDate deben tener formato YYYY-MM-DD.", startedAt },
        { status: 400 },
      );
    }

    const rangeDays = daysBetween(startDate, endDate);
    if (rangeDays <= 0) {
      return NextResponse.json(
        { ok: false, mode, error: "startDate debe ser menor que endDate.", startedAt },
        { status: 400 },
      );
    }
    if (rangeDays > MAX_RANGE_DAYS) {
      return NextResponse.json(
        { ok: false, mode, error: `El rango maximo permitido es ${MAX_RANGE_DAYS} dias.`, startedAt },
        { status: 400 },
      );
    }
    if (mode !== "syncOnly") {
      return NextResponse.json(
        { ok: false, mode, error: "Solo se permite mode=syncOnly en esta fase.", startedAt },
        { status: 400 },
      );
    }
    if (source !== DEFAULT_SOURCE) {
      return NextResponse.json(
        {
          ok: false,
          mode,
          error: `Solo se permite source=${DEFAULT_SOURCE} en esta fase.`,
          startedAt,
        },
        { status: 400 },
      );
    }

    const requestedMarketplaceIds = normalizeMarketplaceIds(body.marketplaceIds);
    const configuredOrExplicitMarketplaceIds =
      requestedMarketplaceIds ?? parseMarketplaceEnv();
    const observedValidMarketplaceIds = await loadMarketplaceIdsFromView({
      startDate,
      endDate,
    });
    const canonicalSyncMarketplaceIds = buildCanonicalSalesMarketplaceScope(
      configuredOrExplicitMarketplaceIds,
      observedValidMarketplaceIds,
    );
    if (canonicalSyncMarketplaceIds.length === 0) {
      throw new Error(
        "No hay marketplaces solicitados u observados validos para sincronizar ventas FBA canonical.",
      );
    }

    const { data, error } = await supabaseAdmin.rpc(
      "sync_ventas_diarias_from_amazon_fba_sales",
      {
        p_start_date: startDate,
        p_end_date: endDate,
        p_marketplace_ids: canonicalSyncMarketplaceIds,
        p_tipo_cliente: tipoCliente,
        p_source: source,
      },
    );

    if (error) throw new Error(error.message);

    const result = (data ?? {}) as SyncResult;
    const warnings: string[] = [];
    const insertedRows = Number(result.inserted ?? 0);
    const insertedUnits = Number(result.units ?? 0);
    const orphanRows = Number(result.orphanRows ?? 0);
    const orphanUnits = Number(result.orphanUnits ?? 0);
    const skippedSourceConflicts = Number(result.skippedSourceConflicts ?? 0);
    const resultMarketplaces = Array.isArray(result.marketplaces)
      ? result.marketplaces
      : [];

    if (insertedRows === 0 && skippedSourceConflicts === 0) {
      warnings.push("No hay datos en v_amazon_fba_sales_daily para el rango solicitado.");
    }
    if (orphanRows > 0) {
      warnings.push(
        "Hay ventas FBA sin producto_id. Se omiten porque no están vinculadas a productos gestionados.",
      );
    }
    if (skippedSourceConflicts > 0) {
      warnings.push(
        "Hay filas FBA cuyo grano ya existe en ventas_diarias con otro source. No se han tocado esas fuentes.",
      );
    }

    const finishedAt = new Date().toISOString();
    await updateSyncJob({
      finishedAt,
      status: "SUCCESS",
      error: null,
      rowsUpserted: insertedRows,
    });

    return NextResponse.json({
      ok: true,
      mode,
      source,
      tipoCliente,
      range: { startDate, endDate },
      marketplaceIds:
        canonicalSyncMarketplaceIds.length > 0
          ? canonicalSyncMarketplaceIds
          : resultMarketplaces,
      deletedPreviousRows: Number(result.deleted ?? 0),
      insertedRows,
      insertedUnits,
      orphanRows,
      orphanUnits,
      skippedSourceConflicts,
      orphanMarketplaces: result.orphanMarketplaces ?? [],
      orphanCountries: result.orphanCountries ?? [],
      warnings,
      startedAt,
      finishedAt,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    const finishedAt = new Date().toISOString();
    await updateSyncJob({
      finishedAt,
      status: "ERROR",
      error: mapped.message,
      rowsUpserted: null,
    });

    return NextResponse.json(
      {
        ok: false,
        mode: "syncOnly",
        error: mapped.message,
        code: mapped.code,
        startedAt,
        finishedAt,
      },
      { status: mapped.status ?? 500 },
    );
  }
}
