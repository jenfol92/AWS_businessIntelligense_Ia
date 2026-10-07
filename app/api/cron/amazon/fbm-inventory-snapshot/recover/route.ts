import { timingSafeEqual } from "node:crypto";
import { recoverPendingFbmSync } from "@/modules/amazon-sp-api/fbmSyncRecovery";
import { fbmHttpStatus } from "@/modules/amazon-sp-api/fbmSyncPolicy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function recover(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "CRON_SECRET_MISSING" }, { status: 503 });
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  try {
    const result = await recoverPendingFbmSync();
    return Response.json(result ?? { status: "IDLE" }, { status: result ? fbmHttpStatus(result.status) : 200 });
  } catch {
    return Response.json({ error: "FBM_RECOVERY_UNAVAILABLE" }, { status: 503 });
  }
}
export const POST = recover;
export const GET = recover;
