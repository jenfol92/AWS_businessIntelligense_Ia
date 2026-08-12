import { NextResponse } from "next/server";
import { requireFinanceDetailsAccess, requireTreasuryAccess, getFinanceAccessErrorResponse } from "@/server/auth/requireFinanceAccess";
import { createPlannedMaturity, listPlannedMaturities } from "@/modules/finance/repositories/creditLinePlannedMaturitiesRepository";
import { normalizePlannedMaturityInput, plannedMaturityError } from "@/modules/finance/services/creditLinePlannedMaturityValidation";
import { assertDateRange, isRealIsoDate, isUuid } from "@/modules/finance/utils/financeInputValidation";

function failure(error:unknown){const access=getFinanceAccessErrorResponse(error);const x=access??plannedMaturityError(error);return NextResponse.json("body" in x?x.body:{ok:false,code:x.code,error:x.error},{status:x.status});}
export async function GET(req:Request){try{const {supabase,role}=await requireTreasuryAccess();const u=new URL(req.url);const creditLineId=u.searchParams.get("creditLineId")??undefined;const from=u.searchParams.get("from")??undefined;const to=u.searchParams.get("to")??undefined;const status=u.searchParams.get("status")??"all";if(creditLineId&&!isUuid(creditLineId))throw new Error("INVALID_UUID");if((from&&!isRealIsoDate(from))||(to&&!isRealIsoDate(to)))throw new Error("INVALID_DATE");assertDateRange(from??null,to??null);const rows=await listPlannedMaturities(supabase,{creditLineId,from,to,status});return NextResponse.json({ok:true,data:rows,permissions:{canManage:role==="admin"||role==="accounting"}});}catch(e){return failure(e);}}
export async function POST(req:Request){try{const {supabase}=await requireFinanceDetailsAccess();const input=normalizePlannedMaturityInput(await req.json());return NextResponse.json({ok:true,data:await createPlannedMaturity(supabase,input)});}catch(e){return failure(e);}}
