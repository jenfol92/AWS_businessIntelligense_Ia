"use client";

/**
 * modules/policies-compliance/components/PolicyAlertRow.tsx
 *
 * Renders one row of the policy alerts table.
 * Receives a GroupedPolicyAlert directly from the backend and renders each field.
 * No calculations. No state deduction. No grouping.
 */

import Image from "next/image";
import type { GroupedPolicyAlert } from "../types/policyCompliance.types";
import { PolicyAlertMarketplaceList } from "./PolicyAlertMarketplaceList";

type PolicyAlertRowProps = {
  alert: GroupedPolicyAlert;
  onSync: (asin: string) => void;
  onMarkResolved: (alertId: string) => void;
  onDetail: (alert: GroupedPolicyAlert) => void;
  syncing: boolean;
};

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleString("es-ES", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PolicyAlertRow({
  alert,
  onSync,
  onMarkResolved,
  onDetail,
  syncing,
}: PolicyAlertRowProps) {
  return (
    <tr className="align-top hover:bg-slate-50/70 transition-colors">

      {/* Fecha */}
      <td className="px-4 py-3 text-xs tabular-nums text-slate-500 whitespace-nowrap">
        {formatDate(alert.created_at)}
      </td>

      {/* Imagen + nombre + marca */}
      <td className="px-4 py-3">
        <div className="flex items-start gap-2 min-w-[140px]">
          {alert.product_image_url ? (
            <Image
              src={alert.product_image_url}
              alt={alert.product_title ?? alert.asin}
              width={40}
              height={40}
              className="rounded border border-slate-100 object-contain shrink-0"
              unoptimized
            />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded border border-slate-100 bg-slate-50 flex items-center justify-center text-slate-300 text-[10px]">
              IMG
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-800 line-clamp-2">
              {alert.product_title ?? "—"}
            </p>
            {alert.product_brand ? (
              <p className="mt-0.5 text-[10px] text-slate-400">{alert.product_brand}</p>
            ) : null}
          </div>
        </div>
      </td>

      {/* SKU */}
      <td className="px-4 py-3">
        <span className="font-mono text-xs text-slate-700">{alert.sku}</span>
      </td>

      {/* ASIN */}
      <td className="px-4 py-3">
        <span className="font-mono text-xs text-slate-700">{alert.asin}</span>
      </td>

      {/* Concepto (category) */}
      <td className="px-4 py-3 text-xs text-slate-700 max-w-[180px]">
        {alert.category}
      </td>

      {/* Motivo (type) */}
      <td className="px-4 py-3 text-xs text-slate-600 max-w-[200px]">
        <p>{alert.type}</p>
        {alert.description ? (
          <p className="mt-0.5 text-[10px] text-slate-400 line-clamp-2">
            {alert.description}
          </p>
        ) : null}
      </td>

      {/* Países afectados */}
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {alert.countries.length > 0
            ? alert.countries.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700"
                >
                  {c}
                </span>
              ))
            : <span className="text-xs text-slate-400">—</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {alert.marketplaces.map((m) => (
            <span
              key={m}
              className="font-mono text-[9px] text-slate-400"
            >
              {m}
            </span>
          ))}
        </div>
      </td>

      {/* Estado por país */}
      <td className="px-4 py-3">
        <PolicyAlertMarketplaceList statuses={alert.marketplace_statuses} />
      </td>

      {/* Acciones */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1.5 items-start">
          <button
            type="button"
            onClick={() => onDetail(alert)}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 transition whitespace-nowrap"
          >
            Ver detalle
          </button>
          <button
            type="button"
            onClick={() => onSync(alert.asin)}
            disabled={syncing}
            className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 transition whitespace-nowrap disabled:opacity-50"
          >
            {syncing ? "Sincronizando…" : "Sincronizar"}
          </button>
          {alert.marketplace_statuses.map((ms) =>
            ms.status !== "resolved" ? (
              <button
                key={ms.alert_id}
                type="button"
                onClick={() => onMarkResolved(ms.alert_id)}
                className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition whitespace-nowrap"
              >
                Resolver {ms.country_code}
              </button>
            ) : null,
          )}
        </div>
      </td>
    </tr>
  );
}
