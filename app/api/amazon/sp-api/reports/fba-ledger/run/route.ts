import { NextResponse } from "next/server";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import {
  commitFbaLedgerReportJob,
  downloadAndPreviewFbaLedgerReportJob,
  refreshFbaLedgerReportJobStatus,
  requestFbaLedgerReportJob,
} from "@/modules/amazon-sp-api/fbaLedgerReportService";
import { isAdminUser } from "@/server/auth/adminAuthorization";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { LedgerAlreadyRunningError } from "@/modules/amazon-sp-api/fbaLedgerExecutionLock";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseRouteClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      return NextResponse.json({ ok: false, error: "No autenticado." }, { status: 401 });
    }
    if (!(await isAdminUser(data.user))) {
      return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "request").trim().toLowerCase();
    if (!["request", "poll", "preview", "commit"].includes(action)) {
      return NextResponse.json(
        { ok: false, error: "Accion no soportada." },
        { status: 400 },
      );
    }
    const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
    if ((action === "poll" || action === "preview" || action === "commit") && !jobId) {
      return NextResponse.json(
        { ok: false, error: "jobId es obligatorio para poll y commit." },
        { status: 400 },
      );
    }

    const result =
      action === "poll"
        ? await refreshFbaLedgerReportJobStatus(jobId)
        : action === "preview"
          ? await downloadAndPreviewFbaLedgerReportJob(jobId)
        : action === "commit"
          ? await commitFbaLedgerReportJob(jobId)
          : await requestFbaLedgerReportJob({
              date: typeof body.date === "string" ? body.date : null,
              source: "manual",
            });

    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof LedgerAlreadyRunningError) {
      return NextResponse.json({
        ok: false,
        code: error.code,
        error: error.message,
        existingRunId: error.existingRunId,
        existingJobId: error.existingJobId,
      }, { status: 409 });
    }
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, code: mapped.code, error: mapped.message },
      { status: mapped.status ?? 400 },
    );
  }
}
