import { NextRequest, NextResponse } from "next/server";

import { isStockagileSyncEnabled } from "@/modules/stockagile/stockagileClient";
import {
  fetchAndImportStockagileOrders,
  syncStockagileFbmSales,
} from "@/modules/stockagile/stockagileOrdersService";
import { STOCKAGILE_FBM_SOURCE } from "@/modules/stockagile/stockagileTypes";

export const dynamic = "force-dynamic";

const MAX_RANGE_DAYS = 31;

type Body = {
  startDate?: unknown;
  endDate?: unknown;
  mode?: unknown;
  source?: unknown;
  tipoCliente?: unknown;
  stockagileOrdersPath?: unknown;
};

function getCronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
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

function errorResponse(params: {
  status: number;
  mode: string;
  error: string;
  startedAt: string;
}) {
  return NextResponse.json(
    {
      ok: false,
      mode: params.mode,
      error: params.error,
      startedAt: params.startedAt,
      finishedAt: new Date().toISOString(),
    },
    { status: params.status },
  );
}

export async function POST(request: NextRequest) {
  const startedAt = new Date().toISOString();
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return errorResponse({
      status: 500,
      mode: "syncOnly",
      error: "CRON_SECRET no configurado.",
      startedAt,
    });
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (authorization !== `Bearer ${cronSecret}`) {
    return errorResponse({
      status: 401,
      mode: "syncOnly",
      error: "No autorizado.",
      startedAt,
    });
  }

  try {
    const body = await readBody(request);
    const defaults = getDefaultRange();
    const startDate = body.startDate == null ? defaults.startDate : body.startDate;
    const endDate = body.endDate == null ? defaults.endDate : body.endDate;
    const mode = typeof body.mode === "string" && body.mode.trim() ? body.mode.trim() : "syncOnly";
    const source =
      typeof body.source === "string" && body.source.trim()
        ? body.source.trim()
        : STOCKAGILE_FBM_SOURCE;
    const tipoCliente =
      typeof body.tipoCliente === "string" && body.tipoCliente.trim()
        ? body.tipoCliente.trim()
        : "B2C";
    const stockagileOrdersPath =
      typeof body.stockagileOrdersPath === "string" && body.stockagileOrdersPath.trim()
        ? body.stockagileOrdersPath.trim()
        : null;

    if (!isDateOnly(startDate) || !isDateOnly(endDate)) {
      return errorResponse({
        status: 400,
        mode,
        error: "startDate y endDate deben tener formato YYYY-MM-DD.",
        startedAt,
      });
    }

    const rangeDays = daysBetween(startDate, endDate);
    if (rangeDays <= 0) {
      return errorResponse({
        status: 400,
        mode,
        error: "startDate debe ser menor que endDate.",
        startedAt,
      });
    }
    if (rangeDays > MAX_RANGE_DAYS) {
      return errorResponse({
        status: 400,
        mode,
        error: `El rango maximo permitido es ${MAX_RANGE_DAYS} dias.`,
        startedAt,
      });
    }
    if (source !== STOCKAGILE_FBM_SOURCE) {
      return errorResponse({
        status: 400,
        mode,
        error: `Solo se permite source=${STOCKAGILE_FBM_SOURCE} en esta fase.`,
        startedAt,
      });
    }
    if (mode !== "syncOnly" && mode !== "fetchAndSync") {
      return errorResponse({
        status: 400,
        mode,
        error: "mode debe ser syncOnly o fetchAndSync.",
        startedAt,
      });
    }

    const importSummary =
      mode === "fetchAndSync"
        ? await (async () => {
            if (!isStockagileSyncEnabled()) {
              throw new Error("STOCKAGILE_SYNC_ENABLED debe ser true para mode=fetchAndSync.");
            }
            return fetchAndImportStockagileOrders({
              startDate,
              endDate,
              source,
              ordersPath: stockagileOrdersPath,
            });
          })()
        : null;

    const syncSummary = await syncStockagileFbmSales({
      startDate,
      endDate,
      source,
      tipoCliente,
    });

    const warnings: string[] = [];
    if (syncSummary.nonTwinlyRows > 0) {
      warnings.push("Hay ventas Stockagile no Twinly. Se omiten conscientemente.");
    }
    if (syncSummary.orphanTwinlyRows > 0) {
      warnings.push("Hay ventas Stockagile Twinly sin producto_id. Revisar maestro de productos.");
    }
    if (syncSummary.skippedCancelledRows > 0) {
      warnings.push("Hay pedidos Stockagile cancelados/anulados omitidos.");
    }
    if (syncSummary.skippedFbaRows > 0) {
      warnings.push("Hay lineas Stockagile marcadas FBA/AFN omitidas del flujo FBM.");
    }

    return NextResponse.json({
      ok: true,
      mode,
      source,
      tipoCliente,
      range: { startDate, endDate },
      importSummary,
      ...syncSummary,
      warnings,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse({
      status: 500,
      mode: "syncOnly",
      error: message,
      startedAt,
    });
  }
}
