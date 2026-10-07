"use client";

import { useEffect, useRef, useState } from "react";
import type { FbmResult } from "@/modules/amazon-sp-api/fbmSyncCoordinator";
import { fbmSyncMessage } from "../services/fbmSyncUi";

const endpoint = "/api/amazon/inventory/fbm-snapshot/import";
const pending = (value: FbmResult | null) => value && ["PENDING", "PROCESSING", "RATE_LIMITED"].includes(value.status);

export function FbmSyncButton({ onCompleted }: { onCompleted: () => void }) {
  const [job, setJob] = useState<FbmResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const completed = useRef<string | null>(null);
  const onCompletedRef = useRef(onCompleted);
  onCompletedRef.current = onCompleted;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function observe() {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const value = await response.json() as FbmResult | null;
        if (cancelled) return;
        setJob(value);
        if (value?.status === "COMPLETED" && completed.current !== value.jobId) {
          completed.current = value.jobId;
          onCompletedRef.current();
        }
      } catch { /* Read failures never create a new report. */ }
      finally { if (!cancelled) timer = setTimeout(observe, 30_000); }
    }
    void observe();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, []);

  async function start() {
    if (busy.current || pending(job)) return;
    busy.current = true; setLoading(true); setError(null);
    try {
      const retryAfterJobId = job && ["CANCELLED", "FATAL", "FAILED"].includes(job.status) ? job.jobId : undefined;
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ retryAfterJobId }) });
      const value = await response.json() as FbmResult & { error?: string };
      if (response.status === 202 || (response.ok && value.status === "COMPLETED")) {
        setJob(value);
        if (value.status === "COMPLETED") onCompletedRef.current();
      } else {
        if (value.jobId) setJob(value);
        setError(value.error ?? "No se pudo iniciar FBM.");
      }
    } catch { setError("No se pudo confirmar la respuesta. Consulta el estado antes de reintentar."); }
    finally { busy.current = false; setLoading(false); }
  }
  return <div className="flex flex-col gap-1">
    <button type="button" onClick={() => void start()} disabled={loading || Boolean(pending(job))}
      className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
      {loading ? "Iniciando FBM…" : pending(job) ? "FBM en curso" : "Actualizar stock FBM"}
    </button>
    {pending(job) ? <span role="status" className="text-xs text-slate-600">
      {fbmSyncMessage(job)}
    </span> : null}
    {job?.status === "COMPLETED" ? <span role="status" className="text-xs text-emerald-700">{fbmSyncMessage(job)}</span> : null}
    {error || (job && !pending(job) && job.status !== "COMPLETED") ? <span role="alert" className="text-xs text-rose-700">{job && !pending(job) ? fbmSyncMessage(job) : error}{job?.error ? ` (${job.error})` : ""}</span> : null}
  </div>;
}
