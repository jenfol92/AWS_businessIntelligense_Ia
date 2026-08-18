import { NextResponse } from "next/server";
import { FBA_COUNTRY_REPORT_TYPE } from "@/modules/amazon-sp-api/config";
import { mapGenericError } from "@/modules/amazon-sp-api/errors";
import { requestFbaCountryReportJob } from "@/modules/amazon-sp-api/fbaCountryReportService";
import { isAdminUser } from "@/server/auth/adminAuthorization";
import { createSupabaseRouteClient } from "@/server/supabase/routeClient";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = createSupabaseRouteClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    return NextResponse.json({ ok: false, error: "No autenticado." }, { status: 401 });
  }
  if (!(await isAdminUser(data.user))) {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 403 });
  }

  try {
    const { job, reportId, reusedExistingJob } = await requestFbaCountryReportJob();
    return NextResponse.json({
      ok: true,
      jobId: job.id,
      reportId,
      reportType: FBA_COUNTRY_REPORT_TYPE,
      status: job.status,
      marketplaceIds: job.marketplace_ids,
      requestedAt: job.requested_at,
      reusedExistingJob,
    });
  } catch (error: unknown) {
    const mapped = mapGenericError(error);
    return NextResponse.json(
      { ok: false, code: mapped.code, error: mapped.message },
      { status: mapped.status ?? 400 },
    );
  }
}
