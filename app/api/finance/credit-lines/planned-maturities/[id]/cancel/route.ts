import { NextResponse } from "next/server";
import { requireFinanceDetailsAccess,getFinanceAccessErrorResponse } from "@/server/auth/requireFinanceAccess";
import { cancelPlannedMaturity } from "@/modules/finance/repositories/creditLinePlannedMaturitiesRepository";
import { plannedMaturityError } from "@/modules/finance/services/creditLinePlannedMaturityValidation";
import { isUuid } from "@/modules/finance/utils/financeInputValidation";
export async function POST(_:Request,{params}:{params:{id:string}}){try{if(!isUuid(params.id))throw new Error("INVALID_UUID");const {supabase}=await requireFinanceDetailsAccess();return NextResponse.json({ok:true,data:await cancelPlannedMaturity(supabase,params.id)});}catch(e){const a=getFinanceAccessErrorResponse(e);const x=a??plannedMaturityError(e);return NextResponse.json("body" in x?x.body:{ok:false,code:x.code,error:x.error},{status:x.status});}}
