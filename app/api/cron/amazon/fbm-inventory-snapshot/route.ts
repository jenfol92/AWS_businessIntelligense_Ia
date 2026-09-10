import { handleFbmReportsSync } from "@/modules/amazon-sp-api/fbmReportsEntrypoint";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 360;

export async function POST(request: Request) {
  return handleFbmReportsSync(request);
}
