import { gunzipSync } from "node:zlib";
import { spApiRequest } from "./spApiClient";
import type {
  CreateReportInput,
  CreateReportResult,
  SpApiReport,
  SpApiReportDocument,
} from "./types";

const REPORTS_BASE = "/reports/2021-06-30";

export async function createReport(
  input: CreateReportInput,
): Promise<CreateReportResult> {
  const result = await spApiRequest<{ reportId: string }>({
    method: "POST",
    path: `${REPORTS_BASE}/reports`,
    body: {
      reportType: input.reportType,
      marketplaceIds: input.marketplaceIds,
      ...(input.reportOptions ? { reportOptions: input.reportOptions } : {}),
    },
  });

  return { reportId: result.reportId };
}

export async function getReport(reportId: string): Promise<SpApiReport> {
  return spApiRequest<SpApiReport>({
    method: "GET",
    path: `${REPORTS_BASE}/reports/${encodeURIComponent(reportId)}`,
  });
}

export async function getReportDocument(
  reportDocumentId: string,
): Promise<SpApiReportDocument> {
  return spApiRequest<SpApiReportDocument>({
    method: "GET",
    path: `${REPORTS_BASE}/documents/${encodeURIComponent(reportDocumentId)}`,
  });
}

export async function downloadReportDocument(
  document: SpApiReportDocument,
): Promise<string> {
  const res = await fetch(document.url);
  if (!res.ok) {
    throw new Error(`Error descargando documento SP-API (${res.status}).`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  if (document.compressionAlgorithm === "GZIP") {
    return gunzipSync(buffer).toString("utf-8");
  }

  return buffer.toString("utf-8");
}

export function mapAmazonProcessingToJobStatus(
  processingStatus: string,
): "IN_PROGRESS" | "DONE" | "CANCELLED" | "FATAL" | "SUBMITTED" {
  switch (processingStatus) {
    case "IN_QUEUE":
    case "IN_PROGRESS":
      return "IN_PROGRESS";
    case "DONE":
      return "DONE";
    case "CANCELLED":
      return "CANCELLED";
    case "FATAL":
      return "FATAL";
    default:
      return "SUBMITTED";
  }
}
