import { NextRequest, NextResponse } from "next/server";
import { getMissingSpApiEnvKeys } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import {
  downloadReportDocument,
  getReport,
  getReportDocument,
} from "@/modules/amazon-sp-api/reportsClient";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

type RouteParams = {
  params: {
    reportId: string;
  };
};

function isSafeDiagnosticText(text: string): boolean {
  if (text.length > 20_000) return false;
  const lower = text.toLowerCase();
  const piiMarkers = [
    "buyer-email",
    "buyer-name",
    "buyer-phone",
    "recipient-name",
    "ship-address",
    "ship-phone",
    "bill-address",
  ];
  return !piiMarkers.some((marker) => lower.includes(marker));
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createSupabaseRouteClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "No autorizado" }, { status: 401 });
  }

  const missing = getMissingSpApiEnvKeys();
  if (missing.length > 0) {
    return NextResponse.json(
      { ok: false, error: `Faltan variables de entorno: ${missing.join(", ")}` },
      { status: 400 },
    );
  }

  try {
    const reportId = params.reportId.trim();
    const report = await getReport(reportId);
    let diagnosticDocument:
      | {
          available: false;
        }
      | {
          available: true;
          safeText: boolean;
          sizeBytes: number;
          compressionAlgorithm: string | null;
          diagnosticDocumentText?: string;
        } = { available: false };

    if (report.processingStatus === "FATAL" && report.reportDocumentId) {
      const document = await getReportDocument(report.reportDocumentId);
      const text = await downloadReportDocument(document);
      const safeText = isSafeDiagnosticText(text);
      diagnosticDocument = {
        available: true,
        safeText,
        sizeBytes: Buffer.byteLength(text, "utf8"),
        compressionAlgorithm: document.compressionAlgorithm ?? null,
        ...(safeText ? { diagnosticDocumentText: text } : {}),
      };
    }

    return NextResponse.json({
      ok: true,
      reportId: report.reportId,
      reportType: report.reportType,
      processingStatus: report.processingStatus,
      processingStartTime: report.processingStartTime ?? null,
      processingEndTime: report.processingEndTime ?? null,
      dataStartTime: report.dataStartTime ?? null,
      dataEndTime: report.dataEndTime ?? null,
      marketplaceIds: report.marketplaceIds ?? [],
      reportDocumentId: report.reportDocumentId ?? null,
      diagnosticDocument,
      raw: report,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      {
        ok: false,
        error: mapped.message,
        code: mapped.code,
        details: mapped.details,
      },
      { status: mapped.status ?? 400 },
    );
  }
}
