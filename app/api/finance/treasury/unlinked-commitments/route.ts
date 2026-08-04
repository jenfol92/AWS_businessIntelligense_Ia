import { NextResponse } from "next/server";
import { requireTreasuryAccess } from "@/server/auth/requireFinanceAccess";
import { listUnlinkedTreasuryCommitments } from "@/modules/finance/repositories/unlinkedTreasuryRepository";
import { validateTreasuryRange } from "@/modules/finance/services/unlinkedObligationsValidation";
import { unlinkedApiErrorResponse } from "@/modules/finance/services/unlinkedObligationsApiErrors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireTreasuryAccess();
    const query = new URL(request.url).searchParams;
    const { dueFrom, dueTo } = validateTreasuryRange(query.get("dueFrom"), query.get("dueTo"));
    const data = await listUnlinkedTreasuryCommitments(supabase, dueFrom, dueTo);
    return NextResponse.json({ ok: true, data });
  } catch (error) { return unlinkedApiErrorResponse(error); }
}
