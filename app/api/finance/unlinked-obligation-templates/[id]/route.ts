import { NextResponse } from "next/server";
import { requireUnlinkedDetailsAccess, requireUnlinkedManagementAccess } from "@/server/auth/requireFinanceAccess";
import { getUnlinkedObligationTemplateDetail } from "@/modules/finance/services/unlinkedObligationsService";
import { updateUnlinkedObligationTemplateCommand } from "@/modules/finance/services/unlinkedObligationsCommandsService";
import { readUnlinkedJson, unlinkedApiErrorResponse } from "@/modules/finance/services/unlinkedObligationsApiErrors";

type Context = { params: { id: string } };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { supabase } = await requireUnlinkedDetailsAccess();
    return NextResponse.json({ ok: true, data: await getUnlinkedObligationTemplateDetail(params.id, supabase) });
  } catch (error) { return unlinkedApiErrorResponse(error); }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { supabase } = await requireUnlinkedManagementAccess();
    const data = await updateUnlinkedObligationTemplateCommand(params.id, await readUnlinkedJson(request), supabase);
    return NextResponse.json({ ok: true, data });
  } catch (error) { return unlinkedApiErrorResponse(error); }
}
