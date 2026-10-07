import { timingSafeEqual } from "node:crypto";
import { coordinateFbmSync, fbmJobResult, type FbmJob } from "./fbmSyncCoordinator.ts";
import { FBM_REFRESH_MS, fbmHttpStatus } from "./fbmSyncPolicy.ts";

type DailyDependencies = { now(): number; latest(): Promise<FbmJob | null>; start(): ReturnType<typeof coordinateFbmSync> };
/** UTC daily eligibility. Existing pending/failed work is never advanced or replaced here. */
export async function generateDailyFbmSync(deps: DailyDependencies = {
  now: Date.now, latest: async () => (await import("./fbmSyncRepository")).findOrCreateFbmJob({ recoveryOnly: true }), start: () => coordinateFbmSync(),
}) {
  const latest = await deps.latest();
  if (latest) {
    const s = latest.state;
    const today = new Date(deps.now()).toISOString().slice(0, 10);
    const completed = Date.parse(s.completedAt ?? ""), created = Date.parse(s.createIntentAt ?? "");
    if (s.status !== "COMPLETED" || !Number.isFinite(completed) || !Number.isFinite(created) ||
      deps.now() - completed < FBM_REFRESH_MS || new Date(created).toISOString().slice(0, 10) >= today) return fbmJobResult(latest);
  }
  return deps.start();
}

export async function handleDailyFbmGeneration(request: Request, run = generateDailyFbmSync, env = process.env) {
  const respond = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (!["GET", "POST"].includes(request.method)) return respond({ error: "METHOD_NOT_ALLOWED" }, 405);
  const secret = env.CRON_SECRET?.trim();
  if (!secret) return respond({ error: "CRON_SECRET_MISSING" }, 503);
  const received = Buffer.from(request.headers.get("authorization") ?? ""), expected = Buffer.from(`Bearer ${secret}`);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return respond({ error: "UNAUTHORIZED" }, 401);
  if (env.AMAZON_FBM_REPORTS_SYNC_ENABLED !== "true") return respond({ status: "DISABLED" }, 503);
  try {
    const result = await run();
    return respond(result ?? { status: "IDLE" }, result ? fbmHttpStatus(result.status) : 200);
  } catch { return respond({ error: "FBM_GENERATION_UNAVAILABLE" }, 503); }
}
