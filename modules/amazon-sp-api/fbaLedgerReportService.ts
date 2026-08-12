import { loadSpApiConfig } from "./config";
import {
  createReportJob,
  getReportContentFromJob,
  getReportJobById,
  storeReportContentOnJob,
  updateReportJob,
} from "./reportJobsRepository";
import {
  createReport,
  downloadReportDocument,
  getReport,
  getReportDocument,
  mapAmazonProcessingToJobStatus,
} from "./reportsClient";
import { createWaitAndDownloadReport } from "./spApiReportImportUtils";
import { importAmazonFbaLedgerSummaryFromText } from "@/modules/imports/amazon-fba-ledger-summary/service";

export const FBA_LEDGER_REPORT_TYPE = "GET_LEDGER_SUMMARY_VIEW_DATA";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lastCompleteUtcDay(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 1);
  return isoDate(d);
}

function dayBounds(date: string): { dataStartTime: string; dataEndTime: string } {
  return {
    dataStartTime: `${date}T00:00:00Z`,
    dataEndTime: `${date}T23:59:59Z`,
  };
}

function ledgerPayload(params: {
  date?: string | null;
  marketplaceIds?: string[] | null;
}) {
  const config = loadSpApiConfig();
  const requestedDate = params.date?.trim() || lastCompleteUtcDay();
  const marketplaceIds =
    params.marketplaceIds?.map((id) => id.trim()).filter(Boolean) ??
    config.marketplaceIds;
  const { dataStartTime, dataEndTime } = dayBounds(requestedDate);
  return {
    reportType: FBA_LEDGER_REPORT_TYPE,
    marketplaceIds,
    dataStartTime,
    dataEndTime,
    reportOptions: {
      aggregateByLocation: "COUNTRY",
      aggregatedByTimePeriod: "DAILY",
    },
  };
}

export async function requestFbaLedgerReportJob(params: {
  date?: string | null;
  marketplaceIds?: string[] | null;
  source?: "manual" | "scheduler";
} = {}) {
  const payload = ledgerPayload(params);
  const job = await createReportJob({
    reportType: FBA_LEDGER_REPORT_TYPE,
    marketplaceIds: payload.marketplaceIds,
    source: params.source ?? "manual",
  });

  try {
    const { reportId } = await createReport(payload);
    const updated = await updateReportJob(job.id, {
      report_id: reportId,
      status: "SUBMITTED",
      processing_status: "IN_QUEUE",
      raw: {
        ...(job.raw ?? {}),
        requestedCreateReportPayload: payload,
      },
    });

    return {
      ok: true,
      job: updated,
      jobId: updated.id,
      reportId,
      marketplaceIds: payload.marketplaceIds,
      requestedCreateReportPayload: payload,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateReportJob(job.id, {
      status: "ERROR",
      error_message: message,
      raw: {
        ...(job.raw ?? {}),
        requestedCreateReportPayload: payload,
      },
    });
    throw error;
  }
}

export async function refreshFbaLedgerReportJobStatus(jobId: string) {
  const job = await getReportJobById(jobId);
  if (!job) throw new Error("Job SP-API no encontrado.");
  if (job.report_type !== FBA_LEDGER_REPORT_TYPE) {
    throw new Error("El job no es un Inventory Ledger diario.");
  }
  if (!job.report_id) throw new Error("El job no tiene reportId todavia.");

  const report = await getReport(job.report_id);
  const mappedStatus = mapAmazonProcessingToJobStatus(report.processingStatus);
  const updated = await updateReportJob(job.id, {
    processing_status: report.processingStatus,
    status: mappedStatus,
    report_document_id: report.reportDocumentId ?? job.report_document_id,
    completed_at: mappedStatus === "DONE" ? new Date().toISOString() : job.completed_at,
    error_message:
      mappedStatus === "FATAL" || mappedStatus === "CANCELLED"
        ? `Informe Amazon ${report.processingStatus}`
        : job.error_message,
    raw: {
      ...(job.raw ?? {}),
      lastReportSnapshot: report,
    },
  });

  return {
    ok: true,
    job: updated,
    jobId: updated.id,
    reportId: updated.report_id,
    status: updated.status,
    processingStatus: updated.processing_status,
    reportDocumentId: updated.report_document_id,
  };
}

export async function commitFbaLedgerReportJob(jobId: string) {
  let job = await getReportJobById(jobId);
  if (!job) throw new Error("Job SP-API no encontrado.");
  if (job.report_type !== FBA_LEDGER_REPORT_TYPE) {
    throw new Error("El job no es un Inventory Ledger diario.");
  }
  if (job.status === "IMPORTED" || job.raw?.importedAt) {
    throw new Error("Este Ledger ya fue importado anteriormente.");
  }

  if (job.processing_status !== "DONE" || !job.report_document_id) {
    const refreshed = await refreshFbaLedgerReportJobStatus(jobId);
    job = refreshed.job;
  }
  if (job.processing_status !== "DONE" || !job.report_document_id) {
    throw new Error("El Ledger aun no esta DONE o no tiene reportDocumentId.");
  }

  let reportContent = getReportContentFromJob(job);
  if (!reportContent) {
    const document = await getReportDocument(job.report_document_id);
    reportContent = await downloadReportDocument(document);
    job = await storeReportContentOnJob(job.id, reportContent, {
      reportDocumentMeta: document,
    });
  }

  const commit = await importAmazonFbaLedgerSummaryFromText({
    text: reportContent,
    mode: "commit",
    source: "amazon_spapi_ledger_summary_daily",
    sourceFileName: `sp-api-ledger-${job.report_id ?? job.id}.csv`,
    reportDocumentId: job.report_document_id,
    skipUnlinkedProducts: true,
  });
  if (commit.mode !== "commit") {
    throw new Error("La importacion Ledger no devolvio resultado commit.");
  }

  const updated = await updateReportJob(job.id, {
    status: "IMPORTED",
    raw: {
      ...(job.raw ?? {}),
      importedAt: new Date().toISOString(),
      importSummary: commit,
    },
  });

  return { ok: true, job: updated, jobId: updated.id, commit };
}

export async function downloadAndPreviewFbaLedgerReportJob(jobId: string) {
  let job = await getReportJobById(jobId);
  if (!job) throw new Error("Job SP-API no encontrado.");
  if (job.report_type !== FBA_LEDGER_REPORT_TYPE) {
    throw new Error("El job no es un Inventory Ledger diario.");
  }
  if (job.status === "IMPORTED" || job.raw?.importedAt) {
    throw new Error("Este Ledger ya fue importado anteriormente.");
  }

  if (job.processing_status !== "DONE" || !job.report_document_id) {
    const refreshed = await refreshFbaLedgerReportJobStatus(jobId);
    job = refreshed.job;
  }
  if (job.processing_status !== "DONE" || !job.report_document_id) {
    throw new Error("El Ledger aun no esta DONE o no tiene reportDocumentId.");
  }

  let reportContent = getReportContentFromJob(job);
  if (!reportContent) {
    const document = await getReportDocument(job.report_document_id);
    reportContent = await downloadReportDocument(document);
    job = await storeReportContentOnJob(job.id, reportContent, {
      reportDocumentMeta: document,
    });
  }

  const preview = await importAmazonFbaLedgerSummaryFromText({
    text: reportContent,
    mode: "preview",
    source: "amazon_spapi_ledger_summary_daily",
    sourceFileName: `sp-api-ledger-${job.report_id ?? job.id}.csv`,
    reportDocumentId: job.report_document_id,
    skipUnlinkedProducts: true,
  });
  if (preview.mode !== "preview") {
    throw new Error("La preview Ledger no devolvio resultado preview.");
  }

  const updated = await updateReportJob(job.id, {
    status: "PARSED_PREVIEW",
    raw: {
      ...(job.raw ?? {}),
      lastPreviewAt: new Date().toISOString(),
      lastPreviewSummary: {
        mode: preview.mode,
        totalRows: preview.totalRows,
        validRows: preview.validRows,
        importableRows: preview.importableRows,
        productsMatched: preview.validRows - preview.unlinkedProductRows,
        productsUnmatched: preview.unlinkedProductRows,
        warnings: preview.warnings.length,
        conflictRows: preview.conflictRows,
        unknownConditionRows: preview.unknownConditionRows,
      },
    },
  });

  return { ok: true, job: updated, preview };
}

export async function importLatestDailyFbaLedgerFromSpApi(params: {
  date?: string | null;
  marketplaceIds?: string[] | null;
} = {}) {
  const payload = ledgerPayload(params);

  const report = await createWaitAndDownloadReport({
    ...payload,
    maxWaitMs: 120_000,
    pollIntervalMs: 5_000,
  });

  if (!report.documentText) {
    return {
      ok: false,
      reportType: FBA_LEDGER_REPORT_TYPE,
      status: report.status,
      processingStatus: report.processingStatus,
      reportId: report.reportId,
      reportDocumentId: report.report?.reportDocumentId ?? null,
      requestedCreateReportPayload: report.requestedCreateReportPayload,
      imported: null,
      error:
        report.error ??
        `Amazon no entrego documento Ledger. Estado: ${report.status}`,
      diagnosticDocumentExcerpt: report.diagnosticDocumentExcerpt ?? null,
      warnings: report.warnings ?? [],
    };
  }

  const imported = await importAmazonFbaLedgerSummaryFromText({
    text: report.documentText,
    mode: "commit",
    source: "amazon_spapi_ledger_summary_daily",
    sourceFileName: `sp-api-ledger-${report.reportId}.csv`,
    reportDocumentId: report.report?.reportDocumentId ?? report.reportId,
    skipUnlinkedProducts: true,
  });

  return {
    ok: imported.ok,
    reportType: FBA_LEDGER_REPORT_TYPE,
    status: report.status,
    processingStatus: report.processingStatus,
    reportId: report.reportId,
    reportDocumentId: report.report?.reportDocumentId ?? null,
    requestedCreateReportPayload: report.requestedCreateReportPayload,
    dataStartTime: report.report?.dataStartTime ?? payload.dataStartTime,
    dataEndTime: report.report?.dataEndTime ?? payload.dataEndTime,
    imported,
    error: null,
    warnings: report.warnings ?? [],
  };
}
