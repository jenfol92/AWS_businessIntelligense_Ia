import { NextResponse } from "next/server";
import { findDeferredAmazonReleaseDetail } from "@/modules/finance/repositories/financialPlanningRepository";
import {
  getFinanceAccessErrorResponse,
  requireTreasuryAccess,
} from "@/server/auth/requireFinanceAccess";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    await requireTreasuryAccess();
    const url = new URL(req.url);
    const releaseDate = url.searchParams.get("releaseDate")?.trim() ?? undefined;
    const month = url.searchParams.get("month")?.trim() ?? undefined;
    if (!releaseDate && !month) {
      return NextResponse.json(
        { ok: false, error: "Indica releaseDate=YYYY-MM-DD o month=YYYY-MM." },
        { status: 400 },
      );
    }
    if (releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
      return NextResponse.json({ ok: false, error: "releaseDate debe ser YYYY-MM-DD." }, { status: 400 });
    }
    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ ok: false, error: "month debe ser YYYY-MM." }, { status: 400 });
    }

    const runId=url.searchParams.get("runId")??undefined;
    const legacyObservedAt=url.searchParams.get("observedAt")??undefined;
    if((runId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) || (runId && legacyObservedAt) || (legacyObservedAt && !Number.isFinite(Date.parse(legacyObservedAt))))return NextResponse.json({ok:false,error:"Invalid Amazon observation selection"},{status:400});
    const detail = await findDeferredAmazonReleaseDetail({ releaseDate, month, runId, legacyObservedAt });
    return NextResponse.json({
      ok: true,
      semantic: "amazon_release",
      label: "Liberación Amazon (no ingreso bancario)",
      ...detail,
      transactions: detail.transactions.map((row) => ({
        id: row.id,
        sourceKey: row.source_key,
        marketplace: row.marketplace,
        amazonTransactionId: row.amazon_transaction_id,
        amazonTransactionType: row.amazon_transaction_type,
        amazonPostedAt: row.amazon_posted_at,
        amazonReleaseDate: row.amazon_release_date,
        amazonDeferralReason: row.amazon_deferral_reason,
        originalCurrency: row.original_currency,
        originalAmount: row.original_amount,
        amountEur: row.amount_eur ?? row.official_amount_eur ?? row.estimated_amount_eur ?? null,
        expectedBankDate: row.expected_bank_date,
        confidence: row.confidence,
        estimationMethod: row.estimation_method,
      })),
    });
  } catch (error) {
    if(error instanceof Error && ["AMAZON_RUN_NOT_PUBLISHED","AMAZON_LEGACY_SNAPSHOT_CHANGED"].includes(error.message))return NextResponse.json({ok:false,error:error.message},{status:409});
    const access = getFinanceAccessErrorResponse(error);
    if (access) return NextResponse.json(access.body, { status: access.status });
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
