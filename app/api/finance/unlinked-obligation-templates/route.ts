import { NextResponse } from "next/server";
import { requireUnlinkedDetailsAccess, requireUnlinkedManagementAccess } from "@/server/auth/requireFinanceAccess";
import { listUnlinkedObligationTemplates } from "@/modules/finance/services/unlinkedObligationsService";
import { createUnlinkedObligationTemplateCommand } from "@/modules/finance/services/unlinkedObligationsCommandsService";
import { readUnlinkedJson, unlinkedApiErrorResponse } from "@/modules/finance/services/unlinkedObligationsApiErrors";
import { validateTemplateListQuery } from "@/modules/finance/services/unlinkedObligationsValidation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { supabase } = await requireUnlinkedDetailsAccess();
    const query = new URL(request.url).searchParams;
    const data = await listUnlinkedObligationTemplates(validateTemplateListQuery(query), supabase);
    return NextResponse.json({ ok: true, data });
  } catch (error) { return unlinkedApiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase } = await requireUnlinkedManagementAccess();
    const data = await createUnlinkedObligationTemplateCommand(await readUnlinkedJson(request), supabase);
    return NextResponse.json({ ok: true, data }, { status: 201 });
  } catch (error) { return unlinkedApiErrorResponse(error); }
}
