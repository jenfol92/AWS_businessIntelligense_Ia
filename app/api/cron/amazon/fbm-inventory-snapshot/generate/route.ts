import { handleDailyFbmGeneration } from "@/modules/amazon-sp-api/fbmDailyGeneration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: Request) { return handleDailyFbmGeneration(request); }
export const POST = GET;
