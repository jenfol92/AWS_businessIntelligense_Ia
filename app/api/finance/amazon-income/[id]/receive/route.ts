import { NextResponse } from "next/server";
import { getFinanceAccessErrorResponse, requireFinanceDetailsAccess } from "@/server/auth/requireFinanceAccess";
import { receiveAmazonIncome } from "@/modules/finance/services/operatingFlowService";

export async function POST(request: Request,{params}:{params:{id:string}}) {
  try { await requireFinanceDetailsAccess(); } catch(error) { const access=getFinanceAccessErrorResponse(error); return NextResponse.json(access?.body??{ok:false,error:"Internal server error"},{status:access?.status??500}); }
  try { const body=await request.json() as {cashAccountId:string;receivedAmountEur:number;receivedAt:string;reference?:string;idempotencyKey:string}; return NextResponse.json({ok:true,data:await receiveAmazonIncome({forecastId:params.id,...body})}); }
  catch(error) { const message=error instanceof Error?error.message:"AMAZON_RECEIPT_FAILED"; return NextResponse.json({ok:false,error:message},{status:message.includes("IDEMPOTENCY")?409:422}); }
}
