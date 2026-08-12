import { NextRequest,NextResponse } from "next/server";
import { syncAmazonFinancialPlanning } from "@/modules/finance/services/amazonFinancialPlanningSync";

export const dynamic="force-dynamic";
export const maxDuration=300;

function authorized(request:NextRequest){const secret=process.env.CRON_SECRET?.trim();return Boolean(secret)&&request.headers.get("authorization")?.trim()===`Bearer ${secret}`;}
async function run(request:NextRequest){if(!authorized(request))return NextResponse.json({ok:false,error:"No autorizado."},{status:401});try{const observationsOnly=new URL(request.url).searchParams.get("mode")==="observations-only";return NextResponse.json({ok:true,data:await syncAmazonFinancialPlanning({observationsOnly})});}catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:"AMAZON_FINANCE_SYNC_FAILED"},{status:503});}}
export async function GET(request:NextRequest){return run(request);}
export async function POST(request:NextRequest){return run(request);}
