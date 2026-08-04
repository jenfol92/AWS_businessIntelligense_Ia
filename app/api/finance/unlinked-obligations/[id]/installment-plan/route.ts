import { NextResponse } from "next/server";
import { requireUnlinkedManagementAccess } from "@/server/auth/requireFinanceAccess";
import { replaceUnlinkedInstallmentPlanCommand } from "@/modules/finance/services/unlinkedObligationsCommandsService";
import { readUnlinkedJson, unlinkedApiErrorResponse } from "@/modules/finance/services/unlinkedObligationsApiErrors";

type Context = { params: { id: string } };

export async function PUT(request: Request, { params }: Context) {
  try {
    const { supabase } = await requireUnlinkedManagementAccess();
    const data = await replaceUnlinkedInstallmentPlanCommand(params.id, await readUnlinkedJson(request), supabase);
    return NextResponse.json({ ok: true, data });
  } catch (error) { return unlinkedApiErrorResponse(error); }
}
