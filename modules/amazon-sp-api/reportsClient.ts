import { gunzipSync } from "node:zlib";
import type { SpApiRequestInput } from "./spApiClient.ts";
import type {
  CreateReportInput,
  CreateReportResult,
  SpApiReport,
  SpApiReportDocument,
} from "./types";
import { assertAmazonReportId } from "./reportIdentityPolicy.ts";

export type ReportsRequestOptions = Pick<SpApiRequestInput, "signal" | "retryExpiredAccessToken" | "rateLimitRetry" | "onResponseMetadata"> & {
  request?: <T>(input: SpApiRequestInput) => Promise<T>;
};
async function requestReport<T>(input: SpApiRequestInput, options: ReportsRequestOptions = {}): Promise<T> {
  const { request, ...controls } = options;
  return (request ?? (await import("./spApiClient.ts")).spApiRequest)<T>({ ...input, ...controls });
}

const REPORTS_BASE = "/reports/2021-06-30";
export async function createReport(
  input: CreateReportInput,
  options: ReportsRequestOptions = {},
): Promise<CreateReportResult> {
  const result = await requestReport<{ reportId: string }>({
    operation: "createReport",
    method: "POST",
    path: `${REPORTS_BASE}/reports`,
    body: {
      reportType: input.reportType,
      marketplaceIds: input.marketplaceIds,
      ...(input.dataStartTime ? { dataStartTime: input.dataStartTime } : {}),
      ...(input.dataEndTime ? { dataEndTime: input.dataEndTime } : {}),
      ...(input.reportOptions ? { reportOptions: input.reportOptions } : {}),
    },
  }, options);

  return { reportId: result.reportId };
}

export async function getReport(reportId: string, options: ReportsRequestOptions = {}): Promise<SpApiReport> {
  assertAmazonReportId(reportId);
  return requestReport<SpApiReport>({
    operation: "getReport",
    method: "GET",
    path: `${REPORTS_BASE}/reports/${encodeURIComponent(reportId)}`,
  }, options);
}

export async function listReports(input:{reportTypes:string[];processingStatuses?:string[];createdSince:string;pageSize?:number}):Promise<SpApiReport[]>{
  const result=await requestReport<{reports?:SpApiReport[]}>({method:"GET",path:`${REPORTS_BASE}/reports`,query:{reportTypes:input.reportTypes.join(","),processingStatuses:input.processingStatuses?.join(","),createdSince:input.createdSince,pageSize:String(input.pageSize??100)}});return result.reports??[];
}

export async function getReportDocument(
  reportDocumentId: string,
  options: ReportsRequestOptions = {},
): Promise<SpApiReportDocument> {
  return requestReport<SpApiReportDocument>({
    operation: "getReportDocument",
    method: "GET",
    path: `${REPORTS_BASE}/documents/${encodeURIComponent(reportDocumentId)}`,
  }, options);
}

export async function downloadReportDocument(
  document: SpApiReportDocument,
  options?: import("./boundedReportDocument.ts").ReportDownloadOptions,
): Promise<string> {
  if (options) return (await import("./boundedReportDocument.ts")).downloadBoundedReportDocument(document, options);
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
    case "PROCESSING":
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
