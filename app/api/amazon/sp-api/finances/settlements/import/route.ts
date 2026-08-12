import { NextResponse } from "next/server";
import { requireFinanceDetailsAccess, getFinanceAccessErrorResponse } from "@/server/auth/requireFinanceAccess";
import { importAmazonSettlements } from "@/modules/finance/services/amazonSettlementService";

export async function POST(request: Request) {
  try { await requireFinanceDetailsAccess(); }
  catch (error) { const access=getFinanceAccessErrorResponse(error); return NextResponse.json(access?.body??{ok:false,error:"Internal server error"},{status:access?.status??500}); }
  try {
    const body=await request.json() as {marketplace:string;startedAfter:string;startedBefore?:string};
    if (!body.marketplace?.trim() || !body.startedAfter) return NextResponse.json({ok:false,error:"REQUIRED_FIELDS"},{status:400});
    return NextResponse.json({ok:true,data:await importAmazonSettlements(body)});
  } catch (error) {
    return NextResponse.json({ok:false,error:error instanceof Error?error.message:"AMAZON_SETTLEMENT_IMPORT_FAILED"},{status:422});
  }
}
