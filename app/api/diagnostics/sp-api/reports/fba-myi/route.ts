/**
 * Modulo      : diagnostics
 * Archivo     : app/api/diagnostics/sp-api/reports/fba-myi/route.ts
 * Responsabilidad: probar GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA sin persistencia.
 * No debe     : escribir en Supabase, tocar inventario_paises, aplicar stock ni ejecutar cron.
 */

import { NextResponse } from "next/server";

import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import {
  buildFbaMyiParseDiagnostic,
  downloadFbaMyiReportContent,
  FBA_MYI_UNSUPPRESSED_REPORT_TYPE,
  getFbaMyiReportStatus,
  requestFbaMyiUnsuppressedReport,
  resolveFbaMyiMarketplaceCode,
  resolveFbaMyiMarketplaceId,
  type FbaMyiDiagnosticMarketplace,
} from "@/modules/amazon-sp-api/fbaMyiInventoryReportDiagnosticService";

export const dynamic = "force-dynamic";

type DiagnosticStage =
  | "env"
  | "create_report"
  | "report_status"
  | "report_document"
  | "report_parsed";

const POLL_INTERVAL_MS = 9_000;
const POLL_MAX_MS = 60_000;
const SAMPLE_MAX_CHARS = 240;

type AmazonDiagnosticError = {
  status: number | null;
  code: string | null;
  message: string | null;
  details: string | null;
  requestId: string | null;
  headers: Record<string, string>;
  raw: unknown;
};

type DiagnosticErrorPayload = {
  amazonError: AmazonDiagnosticError;
  hint: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalFailure(status: string): boolean {
  return status === "CANCELLED" || status === "FATAL";
}

function isPendingStatus(status: string): boolean {
  return status === "IN_QUEUE" || status === "IN_PROGRESS";
}

function buildDocumentSample(content: string): {
  bytesLength: number;
  lineCount: number;
  headerSample: string;
  firstDataLineSample: string | null;
} {
  const bytesLength = Buffer.byteLength(content, "utf8");
  const lines = content.split(/\r?\n/);
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  return {
    bytesLength,
    lineCount: lines.length,
    headerSample: (nonEmptyLines[0] ?? "").slice(0, SAMPLE_MAX_CHARS),
    firstDataLineSample: nonEmptyLines[1]
      ? nonEmptyLines[1].slice(0, SAMPLE_MAX_CHARS)
      : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstAmazonError(raw: Record<string, unknown> | null): Record<string, unknown> | null {
  const errors = raw?.errors;
  if (!Array.isArray(errors)) return null;
  return asRecord(errors[0]);
}

function stringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text ? text : null;
}

function headersFromDetails(details: unknown): Record<string, string> {
  const raw = asRecord(details);
  const headers = asRecord(raw?.headers);
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]),
  );
}

function amazonErrorFromMapped(error: ReturnType<typeof mapGenericError>): AmazonDiagnosticError {
  const details = asRecord(error.details);
  const amazonError = firstAmazonError(details);
  const headers = headersFromDetails(error.details);

  return {
    status: error.status ?? null,
    code: stringOrNull(amazonError?.code) ?? error.code,
    message: stringOrNull(amazonError?.message) ?? error.message,
    details: stringOrNull(amazonError?.details),
    requestId:
      stringOrNull(details?.requestId) ??
      headers["x-amzn-requestid"] ??
      headers["x-amzn-request-id"] ??
      headers["x-amz-request-id"] ??
      null,
    headers,
    raw: error.details ?? null,
  };
}

function containsAny(value: string | null, needles: string[]): boolean {
  const normalized = String(value ?? "").toLowerCase();
  return needles.some((needle) => normalized.includes(needle.toLowerCase()));
}

function isSpApiRateLimited(amazonError: AmazonDiagnosticError): boolean {
  if (amazonError.status === 429) return true;
  if (
    containsAny(amazonError.code, [
      "Quota",
      "QuotaExceeded",
      "Throttled",
      "TooManyRequests",
      "rate_limited",
    ])
  ) {
    return true;
  }
  if (
    containsAny(amazonError.message, [
      "quota",
      "too many",
      "throttle",
      "rate",
    ])
  ) {
    return true;
  }

  return Object.keys(amazonError.headers).some((header) =>
    containsAny(header, ["quota", "rate", "throttle"]),
  );
}

function isAccessDeniedByStatusOrCode(amazonError: AmazonDiagnosticError): boolean {
  return (
    amazonError.status === 403 &&
    containsAny(amazonError.code, ["Unauthorized", "AccessDenied", "Forbidden"])
  );
}

function isExpiredAccessTokenDiagnostic(amazonError: AmazonDiagnosticError): boolean {
  return (
    containsAny(amazonError.details, [
      "access token you provided has expired",
      "access token expired",
    ]) ||
    containsAny(amazonError.message, [
      "access token you provided has expired",
      "access token expired",
    ])
  );
}

function retryDiagnosticFromAmazonError(
  amazonError: AmazonDiagnosticError,
): Record<string, unknown> | null {
  const raw = asRecord(amazonError.raw);
  return asRecord(raw?.diagnostic);
}

function requestReuseHint(hasReportId: boolean): string {
  return hasReportId
    ? "Esta llamada reutiliza reportId; sigue usando la URL con reportId para evitar crear reports nuevos."
    : "Esta llamada no trae reportId y crea un report nuevo. Si Amazon devuelve reportId o pending, reutiliza despues la URL con reportId.";
}

function diagnosticErrorPayload(
  error: ReturnType<typeof mapGenericError>,
  hasReportId: boolean,
): DiagnosticErrorPayload {
  const amazonError = amazonErrorFromMapped(error);
  const retryDiagnostic = retryDiagnosticFromAmazonError(amazonError);
  let hint = requestReuseHint(hasReportId);

  if (
    isExpiredAccessTokenDiagnostic(amazonError) &&
    retryDiagnostic?.spApiRetryAttempted === true &&
    retryDiagnostic?.spApiRetryResult === "attempted_failed"
  ) {
    hint =
      "El token LWA nuevo sigue siendo rechazado como caducado. Revisar signSpApiRequest/x-amz-access-token, cache del servidor o credenciales LWA.";
  } else if (isExpiredAccessTokenDiagnostic(amazonError)) {
    hint =
      "El access token LWA usado contra SP-API estaba caducado. Se debe refrescar el token y reintentar una vez. No es necesariamente falta de permisos.";
  } else if (isSpApiRateLimited(amazonError)) {
    hint =
      "Amazon parece estar limitando la cuota de SP-API. No repitas la llamada; espera y reutiliza reportId si ya existe.";
  } else if (isAccessDeniedByStatusOrCode(amazonError)) {
    hint = "Amazon denego acceso al report type. Revisar roles y reautorizar.";
  }

  return { amazonError, hint };
}

function jsonError(
  stage: DiagnosticStage,
  message: string,
  status = 400,
  extra?: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      ok: false,
      stage,
      message,
      reportType: FBA_MYI_UNSUPPRESSED_REPORT_TYPE,
      ...(extra ?? {}),
    },
    { status },
  );
}

function jsonPending(params: {
  marketplace: FbaMyiDiagnosticMarketplace;
  marketplaceId: string;
  reportId: string;
  processingStatus: string;
}) {
  return NextResponse.json({
    ok: true,
    stage: "report_status" as const,
    message:
      "Informe MYI solicitado, aun no terminado. Repite la llamada con reportId.",
    reportType: FBA_MYI_UNSUPPRESSED_REPORT_TYPE,
    marketplace: params.marketplace,
    marketplaceId: params.marketplaceId,
    reportId: params.reportId,
    processingStatus: params.processingStatus,
    hint:
      "No repitas la URL sin reportId: una llamada nueva crea otro report. Reutiliza esta URL con reportId para consultar o parsear.",
    nextStatusUrl: `/api/diagnostics/sp-api/reports/fba-myi?marketplace=${params.marketplace}&reportId=${encodeURIComponent(params.reportId)}`,
    nextParseUrl: `/api/diagnostics/sp-api/reports/fba-myi?marketplace=${params.marketplace}&reportId=${encodeURIComponent(params.reportId)}&parse=1`,
  });
}

function jsonDone(params: {
  marketplace: FbaMyiDiagnosticMarketplace;
  marketplaceId: string;
  reportId: string;
  processingStatus: string;
  bytesLength: number;
  lineCount: number;
  headerSample: string;
  firstDataLineSample: string | null;
}) {
  return NextResponse.json({
    ok: true,
    stage: "report_document" as const,
    message: "Informe MYI descargado correctamente. Usa parse=1 para parsear.",
    reportType: FBA_MYI_UNSUPPRESSED_REPORT_TYPE,
    marketplace: params.marketplace,
    marketplaceId: params.marketplaceId,
    reportId: params.reportId,
    processingStatus: params.processingStatus,
    bytesLength: params.bytesLength,
    lineCount: params.lineCount,
    headerSample: params.headerSample,
    firstDataLineSample: params.firstDataLineSample,
  });
}

async function handleParseReport(params: {
  marketplace: FbaMyiDiagnosticMarketplace;
  marketplaceId: string;
  reportId: string;
  skuFilter: string | null;
}) {
  const report = await getFbaMyiReportStatus(params.reportId);
  const processingStatus = report.processingStatus;

  if (isTerminalFailure(processingStatus)) {
    return jsonError(
      "report_status",
      `Informe Amazon ${processingStatus}.`,
      502,
      { reportId: params.reportId, processingStatus },
    );
  }

  if (isPendingStatus(processingStatus) || !report.reportDocumentId) {
    return jsonPending({
      marketplace: params.marketplace,
      marketplaceId: params.marketplaceId,
      reportId: params.reportId,
      processingStatus,
    });
  }

  if (processingStatus !== "DONE" || !report.reportDocumentId) {
    return jsonPending({
      marketplace: params.marketplace,
      marketplaceId: params.marketplaceId,
      reportId: params.reportId,
      processingStatus,
    });
  }

  const content = await downloadFbaMyiReportContent(report.reportDocumentId);
  return NextResponse.json(
    buildFbaMyiParseDiagnostic({
      content,
      marketplace: params.marketplace,
      marketplaceId: params.marketplaceId,
      reportId: params.reportId,
      processingStatus,
      skuFilter: params.skuFilter,
    }),
  );
}

async function handleExistingReport(params: {
  marketplace: FbaMyiDiagnosticMarketplace;
  marketplaceId: string;
  reportId: string;
}) {
  const report = await getFbaMyiReportStatus(params.reportId);
  const processingStatus = report.processingStatus;

  if (isTerminalFailure(processingStatus)) {
    return jsonError(
      "report_status",
      `Informe Amazon ${processingStatus}.`,
      502,
      { reportId: params.reportId, processingStatus },
    );
  }

  if (isPendingStatus(processingStatus) || !report.reportDocumentId) {
    return jsonPending({
      marketplace: params.marketplace,
      marketplaceId: params.marketplaceId,
      reportId: params.reportId,
      processingStatus,
    });
  }

  const content = await downloadFbaMyiReportContent(report.reportDocumentId);
  return jsonDone({
    marketplace: params.marketplace,
    marketplaceId: params.marketplaceId,
    reportId: params.reportId,
    processingStatus,
    ...buildDocumentSample(content),
  });
}

async function handleNewReport(params: {
  marketplace: FbaMyiDiagnosticMarketplace;
  marketplaceId: string;
  parseRequested: boolean;
  skuFilter: string | null;
}) {
  const created = await requestFbaMyiUnsuppressedReport({
    marketplaceId: params.marketplaceId,
  });
  const reportId = created.reportId;
  const pollStartedAt = Date.now();

  while (Date.now() - pollStartedAt <= POLL_MAX_MS) {
    const report = await getFbaMyiReportStatus(reportId);
    const processingStatus = report.processingStatus;

    if (isTerminalFailure(processingStatus)) {
      return jsonError(
        "report_status",
        `Informe Amazon ${processingStatus}.`,
        502,
        { reportId, processingStatus },
      );
    }

    if (processingStatus === "DONE" && report.reportDocumentId) {
      const content = await downloadFbaMyiReportContent(report.reportDocumentId);
      if (params.parseRequested) {
        return NextResponse.json(
          buildFbaMyiParseDiagnostic({
            content,
            marketplace: params.marketplace,
            marketplaceId: params.marketplaceId,
            reportId,
            processingStatus,
            skuFilter: params.skuFilter,
          }),
        );
      }
      return jsonDone({
        marketplace: params.marketplace,
        marketplaceId: params.marketplaceId,
        reportId,
        processingStatus,
        ...buildDocumentSample(content),
      });
    }

    if (Date.now() - pollStartedAt >= POLL_MAX_MS) break;
    await sleep(POLL_INTERVAL_MS);
  }

  const finalReport = await getFbaMyiReportStatus(reportId);
  return jsonPending({
    marketplace: params.marketplace,
    marketplaceId: params.marketplaceId,
    reportId,
    processingStatus: finalReport.processingStatus,
  });
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        stage: "env",
        message: "Diagnostico MYI SP-API no disponible en produccion.",
        reportType: FBA_MYI_UNSUPPRESSED_REPORT_TYPE,
      },
      { status: 404 },
    );
  }

  const missing = getMissingSpApiEnvKeys();
  if (missing.length > 0) {
    return jsonError("env", `Faltan variables de entorno: ${missing.join(", ")}`, 400);
  }

  const url = new URL(req.url);
  const reportId = String(url.searchParams.get("reportId") ?? "").trim() || null;
  const parseRequested = url.searchParams.get("parse") === "1";
  const skuFilter = String(url.searchParams.get("sku") ?? "").trim() || null;

  let marketplace: FbaMyiDiagnosticMarketplace;
  let marketplaceId: string;
  try {
    marketplace = resolveFbaMyiMarketplaceCode(url.searchParams.get("marketplace"));
    marketplaceId = resolveFbaMyiMarketplaceId(marketplace);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Marketplace invalido.";
    return jsonError("env", message, 400);
  }

  try {
    if (parseRequested && reportId) {
      return await handleParseReport({
        marketplace,
        marketplaceId,
        reportId,
        skuFilter,
      });
    }

    if (reportId) {
      return await handleExistingReport({ marketplace, marketplaceId, reportId });
    }

    return await handleNewReport({
      marketplace,
      marketplaceId,
      parseRequested,
      skuFilter,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    const diagnostic = diagnosticErrorPayload(mapped, Boolean(reportId));
    return jsonError(
      reportId ? "report_status" : "create_report",
      mapped.message,
      mapped.status ?? 500,
      {
        ...(reportId ? { reportId } : {}),
        ...diagnostic,
      },
    );
  }
}
