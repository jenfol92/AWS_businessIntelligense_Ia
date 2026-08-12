import { NextResponse } from "next/server";
import { getFinanceAccessErrorResponse, requireFinanceDetailsAccess } from "@/server/auth/requireFinanceAccess";
import { recordOperatingTreasury } from "@/modules/finance/services/operatingFlowService";
import type { OperatingTreasuryInput } from "@/modules/finance/types/operatingFlow.types";

export async function POST(request: Request) {
  try { await requireFinanceDetailsAccess(); } catch(error) { const access=getFinanceAccessErrorResponse(error); return NextResponse.json(access?.body??{ok:false,error:"Internal server error"},{status:access?.status??500}); }
  try { return NextResponse.json({ok:true,data:await recordOperatingTreasury(await request.json() as OperatingTreasuryInput)}); }
  catch(error) { const message=error instanceof Error?error.message:"TREASURY_OPERATION_FAILED"; return NextResponse.json({ok:false,error:message},{status:message.includes("IDEMPOTENCY")?409:422}); }
}
