/**
 * Modulo      : diagnostics
 * Archivo     : app/api/diagnostics/sp-api/reports/fba-country/route.ts
 * Responsabilidad: probar Reports API GET_AFN_INVENTORY_DATA_BY_COUNTRY sin persistencia.
 * No debe     : imprimir secretos, escribir en Supabase, importar inventario ni guardar el informe.
 */

import { NextResponse } from "next/server";

import {
  FBA_COUNTRY_REPORT_TYPE,
  getMissingSpApiEnvKeys,
} from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import {
  createReport,
  downloadReportDocument,
  getReport,
  getReportDocument,
} from "@/modules/amazon-sp-api/reportsClient";
import { buildSpApiFbaCountryParseDiagnostic } from "@/modules/imports/amazon-fba-inventory-by-country/buildSpApiCountryParseDiagnostic";

export const dynamic = "force-dynamic";

const ALLOWED_MARKETPLACES = ["ES", "FR", "DE", "IT", "GB", "PL", "SE"] as const;
type MarketplaceCode = (typeof ALLOWED_MARKETPLACES)[number];

const MARKETPLACE_ENV_BY_CODE: Record<MarketplaceCode, string> = {
  ES: "AMAZON_MARKETPLACE_ES",
  FR: "AMAZON_MARKETPLACE_FR",
  DE: "AMAZON_MARKETPLACE_DE",
  IT: "AMAZON_MARKETPLACE_IT",
  GB: "AMAZON_MARKETPLACE_GB",
  PL: "AMAZON_MARKETPLACE_PL",
  SE: "AMAZON_MARKETPLACE_SE",
};

type DiagnosticStage =
  | "env"
  | "create_report"
  | "report_status"
  | "report_document"
  | "report_parsed";

const POLL_INTERVAL_MS = 9_000;
const POLL_MAX_MS = 60_000;
const SAMPLE_MAX_CHARS = 240;

function resolveMarketplaceCode(raw: string | null): MarketplaceCode {
  const code = String(raw ?? "ES")
    .trim()
    .toUpperCase();
  if ((ALLOWED_MARKETPLACES as readonly string[]).includes(code)) {
    return code as MarketplaceCode;
  }
  throw new Error(`Marketplace no soportado: ${code || "(vacío)"}. Usa ES, FR, DE, IT, GB, PL o SE.`);
}

function resolveMarketplaceId(code: MarketplaceCode): string {
  const envKey = MARKETPLACE_ENV_BY_CODE[code];
  const marketplaceId = String(process.env[envKey] ?? "").trim();
  if (!marketplaceId) {
    throw new Error(`Falta variable de entorno: ${envKey}`);
  }
  return marketplaceId;
}

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
  const headerSample = (nonEmptyLines[0] ?? "").slice(0, SAMPLE_MAX_CHARS);
  const firstDataLineSample = nonEmptyLines[1]
    ? nonEmptyLines[1].slice(0, SAMPLE_MAX_CHARS)
    : null;

  return {
    bytesLength,
    lineCount: lines.length,
    headerSample,
    firstDataLineSample,
  };
}

async function downloadReportContent(reportDocumentId: string): Promise<string> {
  const document = await getReportDocument(reportDocumentId);
  return downloadReportDocument(document);
}

async function downloadReportSample(reportDocumentId: string) {
  const content = await downloadReportContent(reportDocumentId);
  return buildDocumentSample(content);
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
      ...(extra ?? {}),
    },
    { status },
  );
}

function jsonPending(params: {
  marketplace: MarketplaceCode;
  reportId: string;
  processingStatus: string;
}) {
  return NextResponse.json({
    ok: true,
    stage: "report_status" as const,
    message:
      "Informe solicitado, aún no terminado. Repite la llamada con reportId.",
    marketplace: params.marketplace,
    reportId: params.reportId,
    processingStatus: params.processingStatus,
  });
}

function jsonDone(params: {
  marketplace: MarketplaceCode;
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
    message: "Informe FBA Country descargado correctamente.",
    marketplace: params.marketplace,
    reportId: params.reportId,
    processingStatus: params.processingStatus,
    bytesLength: params.bytesLength,
    lineCount: params.lineCount,
    headerSample: params.headerSample,
    firstDataLineSample: params.firstDataLineSample,
  });
}

async function handleExistingReport(
  marketplace: MarketplaceCode,
  reportId: string,
) {
  const report = await getReport(reportId);
  const processingStatus = report.processingStatus;

  if (isTerminalFailure(processingStatus)) {
    return jsonError(
      "report_status",
      `Informe Amazon ${processingStatus}.`,
      502,
      { reportId, processingStatus },
    );
  }

  if (isPendingStatus(processingStatus) || !report.reportDocumentId) {
    return jsonPending({ marketplace, reportId, processingStatus });
  }

  if (processingStatus === "DONE" && report.reportDocumentId) {
    const sample = await downloadReportSample(report.reportDocumentId);
    return jsonDone({
      marketplace,
      reportId,
      processingStatus,
      ...sample,
    });
  }

  return jsonPending({ marketplace, reportId, processingStatus });
}

async function handleParseReport(
  marketplace: MarketplaceCode,
  reportId: string,
) {
  const report = await getReport(reportId);
  const processingStatus = report.processingStatus;

  if (isTerminalFailure(processingStatus)) {
    return jsonError(
      "report_status",
      `Informe Amazon ${processingStatus}.`,
      502,
      { reportId, processingStatus },
    );
  }

  if (isPendingStatus(processingStatus) || !report.reportDocumentId) {
    return jsonPending({ marketplace, reportId, processingStatus });
  }

  if (processingStatus !== "DONE" || !report.reportDocumentId) {
    return jsonPending({ marketplace, reportId, processingStatus });
  }

  try {
    const content = await downloadReportContent(report.reportDocumentId);
    const diagnostic = await buildSpApiFbaCountryParseDiagnostic({
      content,
      marketplace,
      reportId,
      processingStatus,
      reportDocumentId: report.reportDocumentId,
    });
    return NextResponse.json(diagnostic);
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return jsonError(
      "report_parsed",
      mapped.message,
      mapped.status ?? 502,
      { reportId, processingStatus },
    );
  }
}

async function handleNewReport(marketplace: MarketplaceCode, marketplaceId: string) {
  let reportId: string;

  try {
    const created = await createReport({
      reportType: FBA_COUNTRY_REPORT_TYPE,
      marketplaceIds: [marketplaceId],
    });
    reportId = created.reportId;
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return jsonError(
      "create_report",
      mapped.message,
      mapped.status ?? 502,
    );
  }

  const pollStartedAt = Date.now();

  while (Date.now() - pollStartedAt <= POLL_MAX_MS) {
    let report;
    try {
      report = await getReport(reportId);
    } catch (error: unknown) {
      const mapped = mapGenericError(error);
      return jsonError(
        "report_status",
        mapped.message,
        mapped.status ?? 502,
        { reportId },
      );
    }

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
      try {
        const sample = await downloadReportSample(report.reportDocumentId);
        return jsonDone({
          marketplace,
          reportId,
          processingStatus,
          ...sample,
        });
      } catch (error: unknown) {
        const mapped = mapGenericError(error);
        return jsonError(
          "report_document",
          mapped.message,
          mapped.status ?? 502,
          { reportId, processingStatus },
        );
      }
    }

    if (Date.now() - pollStartedAt >= POLL_MAX_MS) {
      break;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  let finalReport;
  try {
    finalReport = await getReport(reportId);
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return jsonError(
      "report_status",
      mapped.message,
      mapped.status ?? 502,
      { reportId },
    );
  }

  return jsonPending({
    marketplace,
    reportId,
    processingStatus: finalReport.processingStatus,
  });
}

/**
 * Diagnóstico Reports API: crea o consulta GET_AFN_INVENTORY_DATA_BY_COUNTRY sin persistir datos.
 */
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      {
        ok: false,
        stage: "env",
        message: "Diagnóstico SP-API no disponible en producción.",
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

  let marketplace: MarketplaceCode;
  try {
    marketplace = resolveMarketplaceCode(url.searchParams.get("marketplace"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Marketplace inválido.";
    return jsonError("env", message, 400);
  }

  let marketplaceId: string;
  try {
    marketplaceId = resolveMarketplaceId(marketplace);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Marketplace no configurado.";
    return jsonError("env", message, 400);
  }

  try {
    if (parseRequested) {
      if (!reportId) {
        return jsonError(
          "report_parsed",
          "El modo parse=1 requiere reportId. Solicita el informe primero y repite con reportId.",
          400,
        );
      }
      return await handleParseReport(marketplace, reportId);
    }

    if (reportId) {
      return await handleExistingReport(marketplace, reportId);
    }
    return await handleNewReport(marketplace, marketplaceId);
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return jsonError(
      reportId ? "report_status" : "create_report",
      mapped.message,
      mapped.status ?? 500,
      reportId ? { reportId } : undefined,
    );
  }
}
