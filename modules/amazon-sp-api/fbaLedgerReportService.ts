import { loadSpApiConfig } from "./config";
import {
  claimReportRequestJob,
  findBlockingAmazonReportJob,
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
import { importAmazonFbaLedgerSummaryFromText } from "@/modules/imports/amazon-fba-ledger-summary/service";
import { countLedgerRowsByDocumentIdentity } from "@/modules/imports/amazon-fba-ledger-summary/repository";
import {
  runWithFbaLedgerExecutionLock,
  unwrapFbaLedgerExecution,
} from "./fbaLedgerExecutionLock";
import {
  fbaLedgerUtcDayBounds,
  lastCompleteFbaLedgerUtcDay,
} from "./fbaLedgerSchedulePolicy";

export const FBA_LEDGER_REPORT_TYPE = "GET_LEDGER_SUMMARY_VIEW_DATA";

function ledgerPayload(params: {
  date?: string | null;
  marketplaceIds?: string[] | null;
}) {
  const config = loadSpApiConfig();
  const requestedDate = params.date?.trim() || lastCompleteFbaLedgerUtcDay();
  const marketplaceIds =
    params.marketplaceIds?.map((id) => id.trim()).filter(Boolean) ??
    config.marketplaceIds;
  const { dataStartTime, dataEndTime } = fbaLedgerUtcDayBounds(requestedDate);
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

async function requestFbaLedgerReportJobUnlocked(params: {
  date?: string | null;
  marketplaceIds?: string[] | null;
  source?: "manual" | "scheduler";
  onJobClaimed?: (jobId: string) => Promise<void>;
} = {}) {
  const payload = ledgerPayload(params);
  const blocking = await findBlockingAmazonReportJob({
    reportType: FBA_LEDGER_REPORT_TYPE,
    recentSince: new Date(Date.now() - 24 * 60 * 60 * 1000),
    marketplaceIds: payload.marketplaceIds,
    requestKey: {
      dataStartTime: payload.dataStartTime,
      dataEndTime: payload.dataEndTime,
      reportOptions: payload.reportOptions,
    },
  });
  if (blocking) {
    await params.onJobClaimed?.(blocking.job.id);
    return {
      ok: true,
      job: blocking.job,
      jobId: blocking.job.id,
      reportId: blocking.job.report_id ?? null,
      marketplaceIds: payload.marketplaceIds,
      requestedCreateReportPayload: payload,
      reusedExistingJob: true,
    };
  }
  const claim = await claimReportRequestJob({
    reportType: FBA_LEDGER_REPORT_TYPE,
    marketplaceIds: payload.marketplaceIds,
    source: params.source ?? "manual",
    requestKey: {
      dataStartTime: payload.dataStartTime,
      dataEndTime: payload.dataEndTime,
      reportOptions: payload.reportOptions,
    },
    requestedCreateReportPayload: payload,
  });
  const job = claim.job;
  await params.onJobClaimed?.(job.id);
  if (!claim.acquired) {
    return {
      ok: true,
      job,
      jobId: job.id,
      reportId: job.report_id ?? null,
      marketplaceIds: payload.marketplaceIds,
      requestedCreateReportPayload: payload,
      reusedExistingJob: true,
    };
  }

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
      reusedExistingJob: false,
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

export async function requestFbaLedgerReportJob(params: {
  date?: string | null;
  marketplaceIds?: string[] | null;
  source?: "manual" | "scheduler";
} = {}) {
  return unwrapFbaLedgerExecution(await runWithFbaLedgerExecutionLock({
    operation: "REQUEST",
    execute: ({ setJobId }) => requestFbaLedgerReportJobUnlocked({
      ...params,
      onJobClaimed: setJobId,
    }),
  }));
}

async function refreshFbaLedgerReportJobStatusUnlocked(jobId: string) {
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

export async function refreshFbaLedgerReportJobStatus(jobId: string) {
  return unwrapFbaLedgerExecution(await runWithFbaLedgerExecutionLock({
    operation: "POLL",
    jobId,
    execute: () => refreshFbaLedgerReportJobStatusUnlocked(jobId),
  }));
}

async function commitFbaLedgerReportJobUnlocked(jobId: string) {
  let job = await getReportJobById(jobId);
  if (!job) throw new Error("Job SP-API no encontrado.");
  if (job.report_type !== FBA_LEDGER_REPORT_TYPE) {
    throw new Error("El job no es un Inventory Ledger diario.");
  }
  if (job.status === "IMPORTED" || job.raw?.importedAt) {
    if (!job.report_document_id) {
      throw new Error("El Ledger importado no conserva reportDocumentId.");
    }
    const documentIdentity = `report:${job.report_document_id}`;
    const persistedDocumentRows = await countLedgerRowsByDocumentIdentity(documentIdentity);
    if (persistedDocumentRows === 0) {
      throw new Error("El job figura importado pero no existen filas para su document_identity.");
    }
    const previousSummary =
      job.raw?.importSummary && typeof job.raw.importSummary === "object"
        ? job.raw.importSummary
        : {};
    const commit = {
      ...previousSummary,
      insertedOrUpdated: 0,
      reportDocumentId: job.report_document_id,
    };
    const updated = await updateReportJob(job.id, {
      raw: {
        ...(job.raw ?? {}),
        importOutcome: "ALREADY_IMPORTED",
        lastIdempotencyCheckAt: new Date().toISOString(),
      },
    });
    return {
      ok: true,
      code: "ALREADY_IMPORTED" as const,
      job: updated,
      jobId: updated.id,
      commit,
    };
  }

  if (job.processing_status !== "DONE" || !job.report_document_id) {
    const refreshed = await refreshFbaLedgerReportJobStatusUnlocked(jobId);
    job = refreshed.job;
  }

  if (job.processing_status !== "DONE" || !job.report_document_id) {
    throw new Error("El Ledger aun no esta DONE o no tiene reportDocumentId.");
  }
  const documentIdentity = `report:${job.report_document_id}`;
  const persistedDocumentRows = await countLedgerRowsByDocumentIdentity(documentIdentity);

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
      importOutcome:
        persistedDocumentRows > 0 && commit.insertedOrUpdated === 0
          ? "ALREADY_IMPORTED"
          : "IMPORTED",
      importSummary: commit,
    },
  });

  return {
    ok: true,
    code:
      persistedDocumentRows > 0 && commit.insertedOrUpdated === 0
        ? "ALREADY_IMPORTED"
        : "IMPORTED",
    job: updated,
    jobId: updated.id,
    commit,
  };
}

export async function commitFbaLedgerReportJob(jobId: string) {
  return unwrapFbaLedgerExecution(await runWithFbaLedgerExecutionLock({
    operation: "COMMIT",
    jobId,
    execute: () => commitFbaLedgerReportJobUnlocked(jobId),
  }));
}

async function downloadAndPreviewFbaLedgerReportJobUnlocked(jobId: string) {
  let job = await getReportJobById(jobId);
  if (!job) throw new Error("Job SP-API no encontrado.");
  if (job.report_type !== FBA_LEDGER_REPORT_TYPE) {
    throw new Error("El job no es un Inventory Ledger diario.");
  }
  if (job.status === "IMPORTED" || job.raw?.importedAt) {
    throw new Error("Este Ledger ya fue importado anteriormente.");
  }

  if (job.processing_status !== "DONE" || !job.report_document_id) {
    const refreshed = await refreshFbaLedgerReportJobStatusUnlocked(jobId);
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

export async function downloadAndPreviewFbaLedgerReportJob(jobId: string) {
  return unwrapFbaLedgerExecution(await runWithFbaLedgerExecutionLock({
    operation: "PREVIEW",
    jobId,
    execute: () => downloadAndPreviewFbaLedgerReportJobUnlocked(jobId),
  }));
}
