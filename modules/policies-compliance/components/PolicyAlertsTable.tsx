"use client";

/**
 * modules/policies-compliance/components/PolicyAlertsTable.tsx
 *
 * Main table component for the policies-compliance module.
 *
 * Renders GroupedPolicyAlert[] exactly as the backend delivers it.
 * No grouping. No calculations. No state deduction.
 * All data arrives pre-processed.
 */

import { useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { GroupedPolicyAlert } from "../types/policyCompliance.types";
import { POLICY_ALERT_COLUMNS } from "./policyAlertConstants";
import { PolicyAlertRow } from "./PolicyAlertRow";
import { usePolicyAlerts } from "./usePolicyAlerts";

// ─── Internal: detail panel (minimal, no recalculation) ──────────────────────

function PolicyAlertDetailPanel({
  alert,
  onClose,
}: {
  alert: GroupedPolicyAlert;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-slate-900/40">
      <div className="h-full w-full max-w-lg overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Detalle de alerta</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-6 text-sm text-slate-700">

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">ASIN</p>
              <p className="font-mono font-medium">{alert.asin}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">SKU</p>
              <p className="font-mono font-medium">{alert.sku}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Nombre del producto</p>
              <p className="font-medium">{alert.product_title ?? "—"}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Concepto</p>
              <p>{alert.category}</p>
            </div>
            <div className="col-span-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Motivo</p>
              <p>{alert.type}</p>
            </div>
            {alert.description ? (
              <div className="col-span-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">Descripción</p>
                <p className="text-xs text-slate-600">{alert.description}</p>
              </div>
            ) : null}
            <div>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Fecha</p>
              <p className="text-xs">{new Date(alert.created_at).toLocaleString("es-ES")}</p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-[10px] uppercase tracking-wide text-slate-400">Estado por marketplace</p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
              {alert.marketplace_statuses.map((ms) => (
                <li key={ms.alert_id} className="flex items-center justify-between px-3 py-2.5">
                  <div>
                    <span className="font-medium">{ms.country_code}</span>
                    <span className="ml-2 font-mono text-[10px] text-slate-400">{ms.marketplace_id}</span>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        ms.status === "active"
                          ? "bg-red-100 text-red-800"
                          : ms.status === "resolved"
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {ms.status === "active"
                        ? "Activa"
                        : ms.status === "resolved"
                        ? "Resuelta"
                        : "Pendiente de revisión"}
                    </span>
                    {ms.last_checked_at ? (
                      <p className="mt-0.5 text-[9px] text-slate-400">
                        Verificado: {new Date(ms.last_checked_at).toLocaleString("es-ES")}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>

        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PolicyAlertsTable() {
  const { data, loading, error, refresh, syncing, syncError, triggerSync } = usePolicyAlerts();
  const [detailAlert, setDetailAlert] = useState<GroupedPolicyAlert | null>(null);

  const handleSync = useCallback(
    async (_asin: string) => {
      // Sync is global for now; per-ASIN endpoint can be wired separately
      await triggerSync();
    },
    [triggerSync],
  );

  const handleMarkResolved = useCallback(
    async (alertId: string) => {
      try {
        await fetch(`/api/policies/alerts/${alertId}/resolve`, {
          method: "PATCH",
          cache: "no-store",
        });
        refresh();
      } catch {
        // Non-critical; user can retry
      }
    },
    [refresh],
  );

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-400 shadow-sm">
        Cargando alertas de cumplimiento…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-8 text-center shadow-sm">
        <p className="text-sm font-medium text-red-700">{error}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-3 rounded-lg border border-red-200 bg-white px-4 py-1.5 text-xs text-red-600 hover:bg-red-50 transition"
        >
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {data.length === 0
            ? "No hay alertas activas."
            : `${data.length} alerta${data.length !== 1 ? "s" : ""}`}
        </p>
        <div className="flex items-center gap-2">
          {syncError ? (
            <p className="text-xs text-red-600">{syncError}</p>
          ) : null}
          <button
            type="button"
            onClick={() => void triggerSync()}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Sincronizando…" : "Sincronizar con Amazon"}
          </button>
          <button
            type="button"
            onClick={refresh}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
          >
            Actualizar
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center text-sm text-slate-400 shadow-sm">
          No hay alertas de cumplimiento registradas.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-[1200px] w-full text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  {POLICY_ALERT_COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className="px-4 py-3 text-left font-medium"
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((alert, idx) => (
                  <PolicyAlertRow
                    key={`${alert.asin}-${alert.sku}-${alert.category}-${alert.type}-${idx}`}
                    alert={alert}
                    onSync={(asin) => void handleSync(asin)}
                    onMarkResolved={(alertId) => void handleMarkResolved(alertId)}
                    onDetail={setDetailAlert}
                    syncing={syncing}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {detailAlert ? (
        <PolicyAlertDetailPanel
          alert={detailAlert}
          onClose={() => setDetailAlert(null)}
        />
      ) : null}
    </>
  );
}
