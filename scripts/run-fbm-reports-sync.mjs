import { fileURLToPath } from "node:url";
import path from "node:path";

// Manual local caller of the production backend. Never reads/prints a signed document URL.
export async function invokeLocalFbmReportsSync(args = process.argv.slice(2), transport = fetch) {
  if (args.length !== 1 || args[0] !== "--run-once") return { status: "EXPLICIT_RUN_REQUIRED" };
  const root = fileURLToPath(new URL("../", import.meta.url));
  if (path.resolve(process.cwd()) !== path.resolve(root)) return { status: "RUN_FROM_REPOSITORY_ROOT" };
  const { loadEnvConfig } = (await import("@next/env")).default;
  loadEnvConfig(root, true, { info() {}, error() {} });
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return { status: "CRON_SECRET_MISSING" };
  const response = await transport("http://localhost:3000/api/cron/amazon/fbm-inventory-snapshot", {
    method: "POST", redirect: "error", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(360_000),
  });
  // Only the backend's safe JSON response is returned; never print a proxy/HTML body.
  if (!response.headers.get("content-type")?.includes("application/json")) return { status: "INVALID_BACKEND_RESPONSE", httpStatus: response.status };
  const result = await response.json();
  return { httpStatus: response.status, ...result };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await invokeLocalFbmReportsSync();
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== "SUCCESS") process.exitCode = 1;
  } catch { console.log(JSON.stringify({ status: "LOCAL_SYNC_REQUEST_FAILED", commitOutcome: "UNKNOWN", instruction: "Inspect baseline before any repeat; no automatic retry." })); process.exitCode = 1; }
}
