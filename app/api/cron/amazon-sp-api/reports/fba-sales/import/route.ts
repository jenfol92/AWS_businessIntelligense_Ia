import { NextRequest, NextResponse } from "next/server";

import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import {
  importFbaSalesFromExistingReport,
  importFbaSalesDailyFromSpApi,
  isSupportedFbaSalesReportType,
  type SupportedFbaSalesReportType,
} from "@/modules/amazon-sp-api/fbaForecastSpApiImportsService";

export const dynamic = "force-dynamic";

const AMAZON_FULFILLED_SHIPMENTS_REPORT_TYPE =
  "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL";

type Body = {
  fromDate?: unknown;
  toDate?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  marketplaceIds?: unknown;
  reportType?: unknown;
  reportId?: unknown;
  existingReportId?: unknown;
};

function defaultDailyRange(now = new Date()): { fromDate: string; toDate: string } {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 3);
  return { fromDate: from.toISOString().slice(0, 10), toDate: to.toISOString().slice(0, 10) };
}

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return false;

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  return authorization === `Bearer ${cronSecret}`;
}

async function readBody(request: NextRequest): Promise<Body> {
  const raw = await request.text();
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" ? (parsed as Body) : {};
}

function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeMarketplaceIds(value: unknown): string[] | undefined {
  if (value == null) return undefined;
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

function normalizeReportType(value: unknown): SupportedFbaSalesReportType {
  if (value == null || value === "") {
    return AMAZON_FULFILLED_SHIPMENTS_REPORT_TYPE;
  }
  if (typeof value !== "string" || !isSupportedFbaSalesReportType(value)) {
    throw new Error(
      "reportType no soportado para ventas FBA. Usa GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL.",
    );
  }
  return value;
}

async function runImport(request: NextRequest, suppliedBody?: Body) {
  const startedAt = new Date().toISOString();

  if (!isAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: "No autorizado.", startedAt },
      { status: 401 },
    );
  }

  const missing = getMissingSpApiEnvKeys();
  if (missing.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `Faltan variables de entorno: ${missing.join(", ")}`,
        startedAt,
      },
      { status: 400 },
    );
  }

  try {
    const body = suppliedBody ?? await readBody(request);
    const fromDate = body.fromDate ?? body.startDate;
    const toDate = body.toDate ?? body.endDate;

    if (!isDateOnly(fromDate) || !isDateOnly(toDate)) {
      return NextResponse.json(
        {
          ok: false,
          error: "fromDate/toDate son obligatorios en formato YYYY-MM-DD.",
          startedAt,
        },
        { status: 400 },
      );
    }

    if (fromDate > toDate) {
      return NextResponse.json(
        {
          ok: false,
          error: "fromDate debe ser menor o igual que toDate.",
          startedAt,
        },
        { status: 400 },
      );
    }

    const reportType = normalizeReportType(body.reportType);
    const marketplaceIds = normalizeMarketplaceIds(body.marketplaceIds);
    const existingReportId =
      typeof body.reportId === "string" && body.reportId.trim()
        ? body.reportId.trim()
        : typeof body.existingReportId === "string" && body.existingReportId.trim()
          ? body.existingReportId.trim()
          : null;
    const summary = existingReportId
      ? await importFbaSalesFromExistingReport({
          reportId: existingReportId,
          fromDate,
          toDate,
          marketplaceIds,
          reportType,
        })
      : await importFbaSalesDailyFromSpApi({
          fromDate,
          toDate,
          marketplaceIds,
          reportType,
        });

    const finishedAt = new Date().toISOString();
    const response = {
      ok: summary.ok,
      reportId: summary.reportId,
      reportType,
      mode: existingReportId ? "existingReport" : "createReport",
      range: { fromDate, toDate },
      marketplaceIds:
        summary.requestedCreateReportPayload?.marketplaceIds ??
        marketplaceIds ??
        [],
      summary,
      requestedCreateReportPayload: summary.requestedCreateReportPayload,
      status: summary.status,
      processingStatus: summary.processingStatus,
      rowsParsed: summary.rowsParsed,
      rowsUpserted: summary.rowsUpserted,
      ventasDiariasUpserted: summary.ventasDiariasUpserted ?? 0,
      ventasDiariasSync: summary.ventasDiariasSync ?? null,
      skippedSourceConflicts: summary.skippedSourceConflicts ?? 0,
      orphanRows: summary.orphanRows ?? 0,
      orphanUnits: summary.orphanUnits ?? 0,
      matchedRows: summary.matchedRows,
      unmatchedRows: summary.unmatchedRows,
      warnings: summary.warnings,
      startedAt,
      finishedAt,
    };

    if (!summary.ok) {
      return NextResponse.json(response, {
        status: summary.status === "RATE_LIMITED" ? 429 : 502,
      });
    }

    return NextResponse.json(response);
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    const finishedAt = new Date().toISOString();
    return NextResponse.json(
      {
        ok: false,
        error: mapped.message,
        code: mapped.code,
        startedAt,
        finishedAt,
      },
      { status: mapped.status ?? 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  return runImport(request);
}

export async function GET(request: NextRequest) {
  return runImport(request, defaultDailyRange());
}
