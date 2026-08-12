import { NextResponse } from "next/server";
import { getFinanceAccessErrorResponse, requireFinanceDetailsAccess } from "@/server/auth/requireFinanceAccess";
import { refinanceCreditLine } from "@/modules/finance/services/operatingFlowService";
import type { CreditLineRefinancingInput } from "@/modules/finance/types/operatingFlow.types";

export async function POST(request: Request) {
  try { await requireFinanceDetailsAccess(); } catch (error) {
    const access=getFinanceAccessErrorResponse(error); return NextResponse.json(access?.body??{ok:false,error:"Internal server error"},{status:access?.status??500});
  }
  try {
    const data=await refinanceCreditLine(await request.json() as CreditLineRefinancingInput);
    return NextResponse.json({ok:true,data});
  } catch(error) {
    const message=error instanceof Error?error.message:"REFINANCING_FAILED";
    const status=message.includes("NOT_FOUND")?404:message.includes("IDEMPOTENCY")?409:422;
    return NextResponse.json({ok:false,error:message},{status});
  }
}
