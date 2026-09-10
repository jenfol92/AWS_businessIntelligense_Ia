import { timingSafeEqual } from "node:crypto";
import { syncAmazonFbmInventoryFromReports } from "./amazonFbmReportsSyncService.ts";

let running = false;
export async function handleFbmReportsSync(request: Request, run = syncAmazonFbmInventoryFromReports) {
  const respond = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.method !== "POST") return respond({ status: "METHOD_NOT_ALLOWED" }, 405);
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return respond({ status: "CRON_SECRET_MISSING" }, 503);
  const supplied = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return respond({ status: "UNAUTHORIZED" }, 401);
  if (process.env.AMAZON_FBM_REPORTS_SYNC_ENABLED !== "true") return respond({ status: "DISABLED" }, 503);
  if (running) return respond({ status: "SYNC_ALREADY_RUNNING" }, 409);
  running = true;
  try {
    const result = await run();
    console.info("[amazon-fbm-reports]", JSON.stringify(result));
    return respond(result, result.status === "SUCCESS" ? 200 : 422);
  } catch { return respond({ status: "INTERNAL_ERROR" }, 500); }
  finally { running = false; }
}
