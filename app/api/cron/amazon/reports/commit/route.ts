import { NextRequest, NextResponse } from "next/server";

import { FBA_COUNTRY_REPORT_TYPE } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { commitFbaCountryReportJob } from "@/modules/amazon-sp-api/fbaCountryReportService";
import {
  getReportContentFromJob,
  getReportJobById,
} from "@/modules/amazon-sp-api/reportJobsRepository";

export const dynamic = "force-dynamic";

function getCronSecret(): string | null {
  return process.env.CRON_SECRET?.trim() || null;
}

function isSchedulerEnabled(): boolean {
  return process.env.AMAZON_REPORT_SCHEDULER_ENABLED?.trim().toLowerCase() !== "false";
}

function badRequest(message: string) {
  return NextResponse.json(
    { ok: false, enabled: true, error: message },
    { status: 400 },
  );
}

function readLastPreviewSummary(raw: Record<string, unknown> | null): {
  productsUnmatched: number | null;
  warnings: number | null;
} {
  const summary = raw?.lastPreviewSummary;
  if (!summary || typeof summary !== "object") {
    return { productsUnmatched: null, warnings: null };
  }
  const record = summary as Record<string, unknown>;
  const productsUnmatched = Number(record.productsUnmatched);
  const warnings = Number(record.warnings);
  return {
    productsUnmatched: Number.isFinite(productsUnmatched)
      ? productsUnmatched
      : null,
    warnings: Number.isFinite(warnings) ? warnings : null,
  };
}

export async function POST(request: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    console.error("[amazon-report-scheduler] missing CRON_SECRET for commit");
    return NextResponse.json(
      { ok: false, enabled: false, error: "CRON_SECRET no configurado." },
      { status: 500 },
    );
  }

  const authorization = request.headers.get("authorization")?.trim() ?? "";
  if (authorization !== `Bearer ${cronSecret}`) {
    console.warn("[amazon-report-scheduler] unauthorized commit request");
    return NextResponse.json(
      { ok: false, enabled: false, error: "No autorizado." },
      { status: 401 },
    );
  }

  if (!isSchedulerEnabled()) {
    console.info("[amazon-report-scheduler] commit disabled");
    return NextResponse.json({
      ok: true,
      enabled: false,
      action: "disabled",
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Body JSON inválido.");
  }

  const jobId =
    body && typeof body === "object"
      ? String((body as { jobId?: unknown }).jobId ?? "").trim()
      : "";

  if (!jobId) {
    return badRequest("jobId es obligatorio.");
  }

  try {
    const job = await getReportJobById(jobId);
    if (!job) return badRequest("Job SP-API no encontrado.");
    if (job.report_type !== FBA_COUNTRY_REPORT_TYPE) {
      return badRequest(`report_type no soportado: ${job.report_type}`);
    }
    if (job.status === "IMPORTED") {
      return badRequest("Este informe ya fue importado anteriormente.");
    }
    if (job.status !== "PARSED_PREVIEW") {
      return badRequest("El job debe estar en status PARSED_PREVIEW.");
    }
    if (job.processing_status !== "DONE") {
      return badRequest("El job debe tener processing_status DONE.");
    }
    if (!job.report_document_id) {
      return badRequest("El job debe tener report_document_id.");
    }
    if (!getReportContentFromJob(job)) {
      return badRequest("El job debe tener raw.reportContent generado por preview.");
    }

    const previewSummary = readLastPreviewSummary(job.raw);
    if (previewSummary.productsUnmatched == null) {
      return badRequest("Falta raw.lastPreviewSummary.productsUnmatched.");
    }
    if (previewSummary.productsUnmatched !== 0) {
      return badRequest(
        `No se permite commit con productsUnmatched=${previewSummary.productsUnmatched}.`,
      );
    }
    if (previewSummary.warnings != null && previewSummary.warnings !== 0) {
      return badRequest(
        `No se permite commit con warnings=${previewSummary.warnings}.`,
      );
    }

    const { job: updatedJob, commit } = await commitFbaCountryReportJob(jobId);

    if (commit.mode !== "commit") {
      return badRequest("La importación no devolvió resultado commit.");
    }

    console.info("[amazon-report-scheduler] report job committed", {
      jobId: updatedJob.id,
      reportId: updatedJob.report_id,
      reportType: updatedJob.report_type,
      inventarioPaisesUpserted: commit.inventarioPaisesUpserted,
      historySnapshotsUpserted: commit.historySnapshotsUpserted,
    });

    return NextResponse.json({
      ok: true,
      jobId: updatedJob.id,
      reportId: updatedJob.report_id,
      action: "imported",
      summary: {
        inventarioPaisesUpserted: commit.inventarioPaisesUpserted,
        historySnapshotsUpserted: commit.historySnapshotsUpserted,
      },
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    console.error("[amazon-report-scheduler] commit error", {
      jobId,
      error: mapped.message,
    });
    return NextResponse.json(
      { ok: false, enabled: true, code: mapped.code, error: mapped.message },
      { status: mapped.status ?? 500 },
    );
  }
}
