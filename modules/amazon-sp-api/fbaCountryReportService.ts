import {
  FBA_COUNTRY_REPORT_TYPE,
  loadSpApiConfig,
} from "./config";
import { mapGenericError, safeSpApiErrorMetadata, SpApiError } from "./errors";
import {
  claimReportRequestJob,
  findBlockingAmazonReportJob,
  getReportJobById,
  getReportContentFromJob,
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
import { importAmazonFbaInventoryByCountryFromText } from "@/modules/imports/amazon-fba-inventory-by-country/service";
import type { AmazonSpApiReportJobRow } from "./types";

type RequestFbaCountryReportJobOptions = {
  marketplaceIds?: string[] | null;
  source?: "manual" | "scheduler";
};

type RequestFbaCountryReportJobResult = {
  job: AmazonSpApiReportJobRow;
  reportId: string | null;
  marketplaceIds: string[];
  usedDefaultMarketplaceIds: boolean;
  reusedExistingJob: boolean;
  blockingReason: "open_job" | "pending" | "stale_open" | "recent_success" | "atomic_claim" | null;
};

function hasImportedMarker(job: AmazonSpApiReportJobRow): boolean {
  return Boolean(job.raw?.importedAt || job.raw?.importSummary);
}

function hasPreviewSummary(job: AmazonSpApiReportJobRow): boolean {
  const summary = job.raw?.lastPreviewSummary;
  return Boolean(summary && typeof summary === "object");
}

export async function requestFbaCountryReportJob(
  options: RequestFbaCountryReportJobOptions = {},
): Promise<RequestFbaCountryReportJobResult> {
  const config = loadSpApiConfig();
  const source = options.source ?? "manual";
  const optionMarketplaceIds = options.marketplaceIds
    ?.map((id) => id.trim())
    .filter(Boolean);
  const marketplaceIds =
    optionMarketplaceIds && optionMarketplaceIds.length > 0
      ? optionMarketplaceIds
      : config.marketplaceIds;
  const usedDefaultMarketplaceIds =
    !optionMarketplaceIds || optionMarketplaceIds.length === 0;

  if (marketplaceIds.length === 0) {
    throw new Error(
      "Faltan credenciales SP-API. Revisa .env.local. (AMAZON_MARKETPLACE_*)",
    );
  }

  const recentSince = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const blocking = await findBlockingAmazonReportJob({
    reportType: FBA_COUNTRY_REPORT_TYPE,
    recentSince,
    marketplaceIds,
  });
  if (blocking) {
    return {
      job: blocking.job,
      reportId: blocking.job.report_id ?? null,
      marketplaceIds,
      usedDefaultMarketplaceIds,
      reusedExistingJob: true,
      blockingReason: blocking.reason,
    };
  }

  const createReportPayload = {
    reportType: FBA_COUNTRY_REPORT_TYPE,
    marketplaceIds,
  };

  console.info("[amazon-sp-api] request fba country report", {
    source,
    reportType: FBA_COUNTRY_REPORT_TYPE,
    marketplaceIdsCount: marketplaceIds.length,
    marketplaceIds,
    usedDefaultMarketplaceIds,
    region: config.region,
    endpoint: config.endpoint,
    hasLwaRefreshToken: Boolean(config.lwaRefreshToken),
    createReportPayload,
  });

  const claim = await claimReportRequestJob({
    reportType: FBA_COUNTRY_REPORT_TYPE,
    marketplaceIds,
    source,
    requestedCreateReportPayload: createReportPayload,
  });
  const job = claim.job;
  if (!claim.acquired) {
    return {
      job,
      reportId: job.report_id ?? null,
      marketplaceIds,
      usedDefaultMarketplaceIds,
      reusedExistingJob: true,
      blockingReason: "atomic_claim",
    };
  }

  try {
    const { reportId } = await createReport(createReportPayload);

    const updated = await updateReportJob(job.id, {
      report_id: reportId,
      status: "SUBMITTED",
      processing_status: "IN_QUEUE",
    });

    return {
      job: updated,
      reportId,
      marketplaceIds,
      usedDefaultMarketplaceIds,
      reusedExistingJob: false,
      blockingReason: null,
    };
  } catch (error) {
    const mapped = mapGenericError(error);
    const safeError = safeSpApiErrorMetadata(error);
    const amazonError =
      mapped.details &&
      typeof mapped.details === "object" &&
      "errors" in mapped.details &&
      Array.isArray((mapped.details as { errors: unknown[] }).errors)
        ? (mapped.details as { errors: Array<{ code?: unknown; message?: unknown }> })
            .errors[0]
        : null;
    console.error("[amazon-sp-api] createReport failed", {
      source,
      reportType: FBA_COUNTRY_REPORT_TYPE,
      marketplaceIdsCount: marketplaceIds.length,
      marketplaceIds,
      region: config.region,
      endpoint: config.endpoint,
      hasLwaRefreshToken: Boolean(config.lwaRefreshToken),
      createReportPayload,
      errorName: mapped.name,
      errorStatus: mapped.status ?? null,
      errorCode: mapped.code,
      errorMessage: mapped.message,
      amazonErrorCode: amazonError?.code ?? null,
      amazonErrorMessage: amazonError?.message ?? null,
    });
    await updateReportJob(job.id, {
      status: "ERROR",
      error_message: safeError.amazonMessage,
      raw: {
        ...(job.raw ?? {}),
        createReportError: safeError,
        createReportErrorAt: new Date().toISOString(),
      },
    });
    throw mapped;
  }
}

export async function refreshFbaCountryReportJobStatus(jobId: string) {
  const job = await getReportJobById(jobId);
  if (!job) throw new Error("Job SP-API no encontrado.");
  if (!job.report_id) throw new Error("El job no tiene reportId todavía.");

  let report;
  try {
    report = await getReport(job.report_id);
  } catch (error) {
    const safeError = safeSpApiErrorMetadata(error);
    await updateReportJob(jobId, {
      error_message: safeError.amazonMessage,
      raw: {
        ...(job.raw ?? {}),
        lastStatusError: safeError,
        lastStatusErrorAt: new Date().toISOString(),
      },
    });
    throw error;
  }
  const mappedStatus = mapAmazonProcessingToJobStatus(report.processingStatus);

  const patch: Parameters<typeof updateReportJob>[1] = {
    processing_status: report.processingStatus,
    status: mappedStatus,
    raw: {
      ...(job.raw ?? {}),
      lastReportSnapshot: report,
    },
  };

  if (report.reportDocumentId) {
    patch.report_document_id = report.reportDocumentId;
  }

  if (mappedStatus === "DONE") {
    patch.completed_at = new Date().toISOString();
  }

  if (mappedStatus === "FATAL" || mappedStatus === "CANCELLED") {
    patch.error_message = `Informe Amazon ${report.processingStatus}`;
  }

  const updated = await updateReportJob(jobId, patch);

  return {
    job: updated,
    processingStatus: report.processingStatus,
    reportDocumentId: report.reportDocumentId ?? null,
  };
}

export async function downloadAndPreviewFbaCountryReportJob(jobId: string) {
  let job = await getReportJobById(jobId);
  if (!job) throw new Error("Job SP-API no encontrado.");

  if (job.status === "IMPORTED" || hasImportedMarker(job)) {
    throw new SpApiError(
      "Este informe ya fue importado; no se puede volver a generar preview.",
      "unknown",
      409,
    );
  }

  if (job.status === "PARSED_PREVIEW" && hasPreviewSummary(job)) {
    throw new SpApiError(
      "Este informe ya tiene preview generado.",
      "unknown",
      409,
    );
  }

  let reportContent = getReportContentFromJob(job);

  if (!reportContent) {
    if (job.status !== "DONE" && job.processing_status !== "DONE") {
      const refreshed = await refreshFbaCountryReportJobStatus(jobId);
      job = refreshed.job;
    }

    if (!job.report_document_id) {
      throw new Error(
        "El informe aún no está DONE o no tiene reportDocumentId. Comprueba el estado.",
      );
    }

    const document = await getReportDocument(job.report_document_id);
    reportContent = await downloadReportDocument(document);
    job = await storeReportContentOnJob(jobId, reportContent, {
      reportDocumentMeta: document,
    });
  }

  const preview = await importAmazonFbaInventoryByCountryFromText({
    text: reportContent,
    mode: "preview",
    source: "amazon_spapi_country_report",
    sourceFileName: `sp-api-${job.report_id ?? job.id}.txt`,
  });

  const updated = await updateReportJob(jobId, {
    status: "PARSED_PREVIEW",
    raw: {
      ...(job.raw ?? {}),
      lastPreviewAt: new Date().toISOString(),
      lastPreviewSummary: {
        mode: preview.mode,
        totalRows: preview.totalRows,
        validRows: preview.validRows,
        importableRows: preview.importableRows,
        productsMatched: preview.validRows - preview.skippedUnlinkedRows,
        productsUnmatched: preview.skippedUnlinkedRows,
        countries: preview.rowsByCountry.map((row) => row.key),
        warnings: preview.warnings.length,
      },
    },
  });

  return {
    job: updated,
    preview,
  };
}

export async function commitFbaCountryReportJob(jobId: string) {
  const job = await getReportJobById(jobId);
  if (!job) throw new Error("Job SP-API no encontrado.");

  if (job.status === "IMPORTED" || hasImportedMarker(job)) {
    throw new SpApiError(
      "Este informe ya fue importado anteriormente.",
      "unknown",
      409,
    );
  }

  if (job.status !== "PARSED_PREVIEW") {
    throw new SpApiError(
      "Primero descarga la vista previa antes de importar.",
      "unknown",
      400,
    );
  }

  if (job.processing_status !== "DONE") {
    throw new SpApiError(
      "El informe debe estar DONE antes de importar.",
      "unknown",
      400,
    );
  }

  const reportContent = getReportContentFromJob(job);
  if (!reportContent) {
    throw new Error(
      "Primero descarga la vista previa antes de importar.",
    );
  }

  const commitResult = await importAmazonFbaInventoryByCountryFromText({
    text: reportContent,
    mode: "commit",
    source: "amazon_spapi_country_report",
    sourceFileName: `sp-api-${job.report_id ?? job.id}.txt`,
  });

  if (commitResult.mode !== "commit") {
    throw new Error("La importación SP-API no devolvió resultado commit.");
  }

  const updated = await updateReportJob(jobId, {
    status: "IMPORTED",
    raw: {
      ...(job.raw ?? {}),
      importedAt: new Date().toISOString(),
      importSummary: {
        inventarioPaisesUpserted: commitResult.inventarioPaisesUpserted,
        historySnapshotsUpserted: commitResult.historySnapshotsUpserted,
      },
    },
  });

  return { job: updated, commit: commitResult };
}
