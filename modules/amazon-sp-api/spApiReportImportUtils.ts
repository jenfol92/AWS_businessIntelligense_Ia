import crypto from "node:crypto";
import Papa from "papaparse";
import {
  createReport,
  downloadReportDocument,
  getReport,
  getReportDocument,
} from "./reportsClient";
import { SpApiError } from "./errors";
import type { SpApiReport } from "./types";

export type RawReportRow = Record<string, string>;

export type ReportImportStatus =
  | "DONE"
  | "PENDING"
  | "RATE_LIMITED"
  | "AMAZON_REPORT_CANCELLED"
  | "AMAZON_REPORT_FATAL";

export type RequestedCreateReportPayload = {
  reportType: string;
  marketplaceIds: string[];
  dataStartTime?: string;
  dataEndTime?: string;
  reportOptions?: Record<string, string>;
};

export type RunReportImportResult = {
  ok: boolean;
  reportId: string;
  status: ReportImportStatus;
  processingStatus: string | null;
  documentText: string | null;
  diagnosticDocumentExcerpt?: string | null;
  report: SpApiReport | null;
  requestedCreateReportPayload: RequestedCreateReportPayload;
  warnings?: string[];
  error?: string;
};

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeHeader(value: string): string {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

export function getField(row: Record<string, unknown>, names: string[]): string {
  const keyByNormalized = new Map<string, string>();
  for (const key of Object.keys(row)) {
    keyByNormalized.set(normalizeHeader(key), key);
  }

  for (const name of names) {
    const key = keyByNormalized.get(normalizeHeader(name));
    if (key) return String(row[key] ?? "").trim();
  }

  return "";
}

export function parseReportRows(text: string): RawReportRow[] {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const parsed = Papa.parse<RawReportRow>(text, {
    header: true,
    delimiter,
    skipEmptyLines: "greedy",
  });

  return (parsed.data ?? []).filter((row) =>
    Object.values(row ?? {}).some((value) => String(value ?? "").trim() !== ""),
  );
}

export function parseInteger(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function parseNumberOrNull(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function parseDateOnly(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const slashUs = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashUs) {
    const month = slashUs[1].padStart(2, "0");
    const day = slashUs[2].padStart(2, "0");
    return `${slashUs[3]}-${month}-${day}`;
  }

  const slashEu = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (slashEu) {
    const day = slashEu[1].padStart(2, "0");
    const month = slashEu[2].padStart(2, "0");
    return `${slashEu[3]}-${month}-${day}`;
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function createWaitAndDownloadReport(params: {
  reportType: string;
  marketplaceIds: string[];
  dataStartTime?: string;
  dataEndTime?: string;
  reportOptions?: Record<string, string>;
  maxWaitMs?: number;
  pollIntervalMs?: number;
}): Promise<RunReportImportResult> {
  const requestedCreateReportPayload: RequestedCreateReportPayload = {
    reportType: params.reportType,
    marketplaceIds: params.marketplaceIds,
    dataStartTime: params.dataStartTime,
    dataEndTime: params.dataEndTime,
    reportOptions: params.reportOptions,
  };

  let created: { reportId: string };
  try {
    created = await createReport({
      reportType: params.reportType,
      marketplaceIds: params.marketplaceIds,
      dataStartTime: params.dataStartTime,
      dataEndTime: params.dataEndTime,
      reportOptions: params.reportOptions,
    });
  } catch (error) {
    if (error instanceof SpApiError && error.code === "rate_limited") {
      return {
        ok: false,
        reportId: "",
        status: "RATE_LIMITED",
        processingStatus: null,
        requestedCreateReportPayload,
        documentText: null,
        report: null,
        error: error.message,
      };
    }
    throw error;
  }

  const deadline = Date.now() + (params.maxWaitMs ?? 90_000);
  const interval = params.pollIntervalMs ?? 5_000;
  let latest: SpApiReport | null = null;

  do {
    try {
      latest = await getReport(created.reportId);
    } catch (error) {
      if (error instanceof SpApiError && error.code === "rate_limited") {
        return {
          ok: false,
          reportId: created.reportId,
          status: "RATE_LIMITED",
          processingStatus: latest?.processingStatus ?? null,
          requestedCreateReportPayload,
          documentText: null,
          report: latest,
          error: error.message,
        };
      }
      throw error;
    }
    if (latest.processingStatus === "DONE") break;
    if (latest.processingStatus === "CANCELLED") {
      return {
        ok: false,
        reportId: created.reportId,
        status: "AMAZON_REPORT_CANCELLED",
        processingStatus: latest.processingStatus,
        requestedCreateReportPayload,
        documentText: null,
        report: latest,
      };
    }
    if (latest.processingStatus === "FATAL") {
      const warnings: string[] = [];
      let diagnosticDocumentExcerpt: string | null = null;
      if (latest.reportDocumentId) {
        try {
          const document = await getReportDocument(latest.reportDocumentId);
          const diagnosticText = await downloadReportDocument(document);
          diagnosticDocumentExcerpt = diagnosticText.slice(0, 4000);
        } catch (error) {
          warnings.push(
            `No se pudo descargar documento diagnostico FATAL: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      return {
        ok: false,
        reportId: created.reportId,
        status: "AMAZON_REPORT_FATAL",
        processingStatus: latest.processingStatus,
        requestedCreateReportPayload,
        documentText: null,
        diagnosticDocumentExcerpt,
        report: latest,
        warnings,
      };
    }
    await sleep(interval);
  } while (Date.now() < deadline);

  if (!latest || latest.processingStatus !== "DONE" || !latest.reportDocumentId) {
    return {
      ok: true,
      reportId: created.reportId,
      status: "PENDING",
      processingStatus: latest?.processingStatus ?? "SUBMITTED",
      requestedCreateReportPayload,
      documentText: null,
      report: latest,
    };
  }

  const document = await getReportDocument(latest.reportDocumentId);
  const documentText = await downloadReportDocument(document);

  return {
    ok: true,
    reportId: created.reportId,
    status: "DONE",
    processingStatus: latest.processingStatus,
    requestedCreateReportPayload,
    documentText,
    report: latest,
  };
}
