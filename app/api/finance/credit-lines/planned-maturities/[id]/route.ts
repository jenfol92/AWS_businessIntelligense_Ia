import { NextResponse } from "next/server";
import { requireFinanceDetailsAccess,getFinanceAccessErrorResponse } from "@/server/auth/requireFinanceAccess";
import { updatePlannedMaturity } from "@/modules/finance/repositories/creditLinePlannedMaturitiesRepository";
import { normalizePlannedMaturityPatchInput,plannedMaturityError } from "@/modules/finance/services/creditLinePlannedMaturityValidation";
import { isUuid } from "@/modules/finance/utils/financeInputValidation";
export async function PATCH(req:Request,{params}:{params:{id:string}}){try{if(!isUuid(params.id))throw new Error("INVALID_UUID");const {supabase}=await requireFinanceDetailsAccess();const input=normalizePlannedMaturityPatchInput(await req.json());return NextResponse.json({ok:true,data:await updatePlannedMaturity(supabase,params.id,input)});}catch(e){const a=getFinanceAccessErrorResponse(e);const x=a??plannedMaturityError(e);return NextResponse.json("body" in x?x.body:{ok:false,code:x.code,error:x.error},{status:x.status});}}
