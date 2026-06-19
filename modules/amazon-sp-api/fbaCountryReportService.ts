import {
  FBA_COUNTRY_REPORT_TYPE,
  loadSpApiConfig,
} from "./config";
import { mapGenericError } from "./errors";
import {
  createReportJob,
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

export async function requestFbaCountryReportJob(): Promise<{
  job: AmazonSpApiReportJobRow;
  reportId: string;
}> {
  const config = loadSpApiConfig();
  const job = await createReportJob({
    reportType: FBA_COUNTRY_REPORT_TYPE,
    marketplaceIds: config.marketplaceIds,
  });

  try {
    const { reportId } = await createReport({
      reportType: FBA_COUNTRY_REPORT_TYPE,
      marketplaceIds: config.marketplaceIds,
    });

    const updated = await updateReportJob(job.id, {
      report_id: reportId,
      status: "SUBMITTED",
      processing_status: "IN_QUEUE",
    });

    return { job: updated, reportId };
  } catch (error) {
    const mapped = mapGenericError(error);
    await updateReportJob(job.id, {
      status: "ERROR",
      error_message: mapped.message,
    });
    throw mapped;
  }
}

export async function refreshFbaCountryReportJobStatus(jobId: string) {
  const job = await getReportJobById(jobId);
  if (!job) throw new Error("Job SP-API no encontrado.");
  if (!job.report_id) throw new Error("El job no tiene reportId todavía.");

  const report = await getReport(job.report_id);
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

  await updateReportJob(jobId, {
    status: "PARSED_PREVIEW",
    raw: {
      ...(job.raw ?? {}),
      lastPreviewAt: new Date().toISOString(),
    },
  });

  return {
    job,
    preview,
  };
}

export async function commitFbaCountryReportJob(jobId: string) {
  const job = await getReportJobById(jobId);
  if (!job) throw new Error("Job SP-API no encontrado.");

  const reportContent = getReportContentFromJob(job);
  if (!reportContent) {
    throw new Error(
      "No hay documento descargado. Ejecuta preview/descarga antes de importar.",
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
