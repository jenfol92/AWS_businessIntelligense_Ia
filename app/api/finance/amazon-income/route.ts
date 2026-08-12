import { NextResponse } from "next/server";
import { getFinanceAccessErrorResponse, requireFinanceDetailsAccess } from "@/server/auth/requireFinanceAccess";
import { saveAmazonIncome } from "@/modules/finance/services/operatingFlowService";
import type { AmazonIncomeInput } from "@/modules/finance/types/operatingFlow.types";

export async function POST(request: Request) {
  try { await requireFinanceDetailsAccess(); } catch(error) { const access=getFinanceAccessErrorResponse(error); return NextResponse.json(access?.body??{ok:false,error:"Internal server error"},{status:access?.status??500}); }
  try { return NextResponse.json({ok:true,data:await saveAmazonIncome(await request.json() as AmazonIncomeInput)}); }
  catch(error) { return NextResponse.json({ok:false,error:error instanceof Error?error.message:"AMAZON_INCOME_FAILED"},{status:422}); }
}
