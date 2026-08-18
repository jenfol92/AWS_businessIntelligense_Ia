import { NextResponse } from "next/server";
import { buildAmazonEconomicForecastV2Live } from "@/modules/finance/services/buildAmazonEconomicForecastV2";
import { getFinanceAccessErrorResponse,requireFinanceDetailsAccess } from "@/server/auth/requireFinanceAccess";

export const dynamic="force-dynamic";
export const revalidate=0;

export async function GET(){
  try{await requireFinanceDetailsAccess();return NextResponse.json({ok:true,data:await buildAmazonEconomicForecastV2Live()});}
  catch(error){const access=getFinanceAccessErrorResponse(error);if(access)return NextResponse.json(access.body,{status:access.status});console.error("[amazon-economic-forecast-v2]",error);return NextResponse.json({ok:false,code:"AMAZON_ECONOMIC_FORECAST_V2_FAILED",error:"Amazon economic forecast V2 failed"},{status:500});}
}

