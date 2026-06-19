"use client";

import React, { useState } from "react";
import { AlertCircle, CheckCircle, Cloud, Loader2 } from "lucide-react";
import type { FbaCountryPreviewResponse } from "@/modules/imports/amazon-fba-inventory-by-country/types";

type SpApiJobState = {
  jobId: string;
  reportId: string | null;
  status: string;
  processingStatus: string | null;
  reportDocumentId: string | null;
  requestedAt: string | null;
};

export function SpApiFbaCountrySection() {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<string | null>(null);
  const [job, setJob] = useState<SpApiJobState | null>(null);
  const [preview, setPreview] = useState<FbaCountryPreviewResponse | null>(null);
  const [commitMessage, setCommitMessage] = useState<string | null>(null);

  async function runAction(
    key: string,
    fn: () => Promise<void>,
  ) {
    setLoading(key);
    setError(null);
    try {
      await fn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex items-start gap-2">
        <Cloud className="mt-0.5 h-4 w-4 text-violet-700" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-violet-950">
            Conectar con Amazon SP-API
          </h3>
          <p className="mt-1 text-xs text-violet-900/80">
            Solicita{" "}
            <code className="rounded bg-white/70 px-1">
              GET_AFN_INVENTORY_DATA_BY_COUNTRY
            </code>{" "}
            desde Amazon. La importación{" "}
            <strong>no se aplica</strong> hasta pulsar “Importar a stock por
            país”.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionButton
          label="Probar conexión"
          loading={loading === "health"}
          onClick={() =>
            runAction("health", async () => {
              const res = await fetch("/api/amazon/sp-api/health");
              const data = await res.json();
              if (!res.ok || !data.ok) throw new Error(data.error ?? "Error");
              setHealthOk(
                `${data.message} (expira en ${data.expiresIn}s)`,
              );
            })
          }
        />
        <ActionButton
          label="Solicitar informe FBA por país"
          loading={loading === "request"}
          onClick={() =>
            runAction("request", async () => {
              setPreview(null);
              setCommitMessage(null);
              const res = await fetch(
                "/api/amazon/sp-api/reports/fba-country/request",
                { method: "POST" },
              );
              const data = await res.json();
              if (!res.ok || !data.ok) throw new Error(data.error ?? "Error");
              setJob({
                jobId: data.jobId,
                reportId: data.reportId,
                status: data.status,
                processingStatus: "IN_QUEUE",
                reportDocumentId: null,
                requestedAt: data.requestedAt ?? null,
              });
            })
          }
        />
        <ActionButton
          label="Comprobar estado"
          disabled={!job?.jobId}
          loading={loading === "status"}
          onClick={() =>
            runAction("status", async () => {
              if (!job?.jobId) return;
              const res = await fetch(
                `/api/amazon/sp-api/reports/${job.jobId}/status`,
              );
              const data = await res.json();
              if (!res.ok || !data.ok) throw new Error(data.error ?? "Error");
              setJob({
                jobId: data.jobId,
                reportId: data.reportId,
                status: data.status,
                processingStatus: data.processingStatus,
                reportDocumentId: data.reportDocumentId,
                requestedAt: data.requestedAt ?? null,
              });
            })
          }
        />
        <ActionButton
          label="Descargar vista previa"
          disabled={!job?.jobId}
          loading={loading === "preview"}
          onClick={() =>
            runAction("preview", async () => {
              if (!job?.jobId) return;
              const res = await fetch(
                `/api/amazon/sp-api/reports/${job.jobId}/preview`,
                { method: "POST" },
              );
              const data = await res.json();
              if (!res.ok || !data.ok) throw new Error(data.error ?? "Error");
              setJob({
                jobId: data.jobId,
                reportId: data.reportId,
                status: data.status,
                processingStatus: data.processingStatus,
                reportDocumentId: data.reportDocumentId,
                requestedAt: data.requestedAt ?? null,
              });
              setPreview(data.preview as FbaCountryPreviewResponse);
              setCommitMessage(null);
            })
          }
        />
        <ActionButton
          label="Importar a stock por país"
          disabled={!job?.jobId || !preview}
          loading={loading === "commit"}
          variant="primary"
          onClick={() =>
            runAction("commit", async () => {
              if (!job?.jobId) return;
              const res = await fetch(
                `/api/amazon/sp-api/reports/${job.jobId}/commit`,
                { method: "POST" },
              );
              const data = await res.json();
              if (!res.ok || !data.ok) throw new Error(data.error ?? "Error");
              setCommitMessage(
                `Importado: ${data.commit.inventarioPaisesUpserted} filas inventario_paises, ${data.commit.historySnapshotsUpserted} snapshots históricos.`,
              );
            })
          }
        />
      </div>

      {healthOk ? (
        <p className="mt-3 flex items-start gap-2 text-xs text-emerald-800">
          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {healthOk}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 flex items-start gap-2 whitespace-pre-line text-xs text-rose-800">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      ) : null}

      {job ? (
        <div className="mt-4 grid gap-2 rounded-lg border border-violet-100 bg-white/70 p-3 text-xs text-slate-700 sm:grid-cols-2">
          <Info label="jobId" value={job.jobId} />
          <Info label="reportId" value={job.reportId ?? "—"} />
          <Info label="estado job" value={job.status} />
          <Info label="estado Amazon" value={job.processingStatus ?? "—"} />
          <Info label="reportDocumentId" value={job.reportDocumentId ?? "—"} />
          <Info label="solicitado" value={job.requestedAt ?? "—"} />
        </div>
      ) : null}

      {preview ? (
        <div className="mt-4 space-y-2 text-xs text-slate-700">
          <p>
            Filas detectadas: <strong>{preview.validRows}</strong> · Importables:{" "}
            <strong>{preview.importableRows}</strong> · SKUs Twinly:{" "}
            <strong>{preview.twinlyRows}</strong> · Sin producto:{" "}
            <strong>{preview.skippedUnlinkedRows}</strong>
          </p>
          {preview.rowsByCountry.length > 0 ? (
            <p>
              Países:{" "}
              {preview.rowsByCountry
                .map((r) => `${r.key} (${r.stockFba} uds)`)
                .join(" · ")}
            </p>
          ) : null}
          {preview.warnings.length > 0 ? (
            <p className="text-amber-800">
              Warnings: {preview.warnings.length} (ver detalle en logs servidor)
            </p>
          ) : null}
        </div>
      ) : null}

      {commitMessage ? (
        <p className="mt-3 flex items-start gap-2 text-xs text-emerald-800">
          <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {commitMessage}
        </p>
      ) : null}
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  loading,
  disabled,
  variant = "default",
}: {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "default" | "primary";
}) {
  const base =
    variant === "primary"
      ? "bg-emerald-600 text-white hover:bg-emerald-700"
      : "bg-white text-slate-800 border border-violet-200 hover:bg-violet-50";

  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-50 ${base}`}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
      {label}
    </button>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-slate-500">{label}: </span>
      <span className="font-mono text-[11px]">{value}</span>
    </div>
  );
}
