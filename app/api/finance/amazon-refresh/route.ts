import { AmazonObservationSchemaError } from "@/modules/finance/utils/amazonObservationSchema";
import { NextResponse } from "next/server";
import { requireFinanceDetailsAccess, getFinanceAccessErrorResponse } from "@/server/auth/requireFinanceAccess";
import { syncAmazonFinancialPlanning } from "@/modules/finance/services/amazonFinancialPlanningSync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  console.info("[finance/amazon-refresh] request received");
  const started = Date.now();
  let phase = "authorization";
  let authTimer: ReturnType<typeof setTimeout> | undefined;
  const heartbeat = setInterval(() => console.info("[finance/amazon-refresh] waiting", {
    phase, elapsedMs: Date.now() - started,
  }), 10_000);
  try {
    console.info("[finance/amazon-refresh] authorization start");
    await Promise.race([
      (async () => await requireFinanceDetailsAccess())(),
      new Promise<never>((_, reject) => {
        authTimer = setTimeout(() => reject(new Error("FINANCE_AUTH_TIMEOUT")), 15_000);
      }),
    ]);
    clearTimeout(authTimer);
    phase = "synchronization";
    console.info("[finance/amazon-refresh] authorization done");
    // Reuse the canonical synchronizer and its database lease. The liquidity button
    // must not recalculate every marketplace/channel forecast before reading Amazon.
    const result = await syncAmazonFinancialPlanning({ observationsOnly: true, signal: AbortSignal.timeout(85_000) });
    const state = result.skipped ? "running" : result.successful ? "succeeded" : "failed";
    console.info("[finance/amazon-refresh] result", { state, durationMs: result.durationMs,
      available: result.availableUpserted, deferred: result.deferredUpserted,
      pendingBank: result.pendingBankUpserted, errorCount: result.errors.length });
    return NextResponse.json({ ok: true, state, lastSyncAt: state === "succeeded" ? result.lastSyncAt : null },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.warn("[finance/amazon-refresh] failed", { phase, elapsedMs: Date.now() - started });
    if (error instanceof AmazonObservationSchemaError) return NextResponse.json({ ok: false, code: error.code, error: error.message }, { status: 503 });
    const access = getFinanceAccessErrorResponse(error);
    if (access) return NextResponse.json({ ...access.body, error: access.status === 403
      ? "Tu sesión no tiene permiso para actualizar Amazon. Se requiere administración o contabilidad."
      : "La sesión ha caducado. Vuelve a iniciar sesión para actualizar Amazon." }, { status: access.status });
    return NextResponse.json({ ok: false, error: phase === "authorization"
      ? "La comprobación de sesión no respondió a tiempo. No se ha iniciado la sincronización de Amazon."
      : "No se pudo completar la sincronización de Amazon. Se mantienen los últimos datos disponibles." }, { status: 503 });
  } finally { clearTimeout(authTimer); clearInterval(heartbeat); }
}
