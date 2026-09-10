"use client";

import { Card, Title } from "@tremor/react";
import type { InventoryProductDetailResponse } from "../types/inventory.types";

function fmtNum(
  n: number | null | undefined,
  digits = 0,
): string {
  if (n == null || Number.isNaN(n)) return "—";

  return n.toLocaleString("es-ES", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";

  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);

  if (Number.isNaN(d.getTime())) return iso;

  return d.toLocaleDateString("es-ES");
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";

  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return iso;

  return d.toLocaleString("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function operationalFbaSourceLabel(
  source: NonNullable<
    InventoryProductDetailResponse["operationalStock"]
  >["stockOperationalFbaSource"],
): string {
  switch (source) {
    case "fba_inventory_snapshot":
      return "snapshot FBA operativo";

    case "country_inventory":
      return "stock por país actualizado";

    case "ledger":
      return "ledger FBA";

    default:
      return "sin stock FBA registrado";
  }
}

export function OperationalStockPanel({
  stock,
}: {
  stock: NonNullable<
    InventoryProductDetailResponse["operationalStock"]
  >;
}) {
  const syncStatus = stock.fbaInventorySyncStatus;

  const countrySummary = stock.stockFbaAppByCountry
    .map(
      (row) =>
        `${row.pais} ${fmtNum(row.stockFba + row.stockFbm)}`,
    )
    .join(" · ");

  return (
    <Card className="ring-1 ring-slate-100 p-4">
      <Title className="mb-3 text-base">Stock operativo</Title>

      <div className="space-y-2 text-sm text-slate-800">
        <p>
          <span className="text-slate-500">
            Stock FBA operativo usado:{" "}
          </span>

          <span className="font-semibold text-slate-900">
            {stock.stockOperationalFbaSource === "none"
              ? "NO DISPONIBLE"
              : `${fmtNum(stock.stockOperationalFba)} uds`}
          </span>
        </p>

        <p className="text-xs text-slate-500">
          Fuente:{" "}
          {operationalFbaSourceLabel(
            stock.stockOperationalFbaSource,
          )}
        </p>

        <p className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-950">
          {stock.stockFbaDualPoolComplete
            ? "Stock operativo procedente del último snapshot atómico PAN-EU + UK."
            : "No existe todavía un snapshot operativo PAN-EU + UK utilizable."}
        </p>

        {stock.stockFbaLatestSnapshot != null &&
        stock.stockFbaLatestSnapshotAt ? (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                {
                  label: "PAN-EU operativo",
                  value: stock.stockFbaPanEu,
                },
                {
                  label: "UK operativo",
                  value: stock.stockFbaUk,
                },
                {
                  label: "FBA operativo total",
                  value: stock.stockFbaLatestSnapshot,
                },
                {
                  label: "Reservado",
                  value: stock.stockFbaReserved,
                },
                {
                  label: "Inbound",
                  value: stock.stockFbaInbound,
                },
                {
                  label: "No apto",
                  value: stock.stockFbaUnfulfillable,
                },
                {
                  label: "En investigación",
                  value: stock.stockFbaResearching,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                >
                  <p className="text-[10px] font-medium uppercase text-slate-400">
                    {item.label}
                  </p>

                  <p className="mt-0.5 font-semibold text-slate-900">
                    {item.value == null
                      ? "NO DISPONIBLE"
                      : `${fmtNum(item.value)} uds`}
                  </p>
                </div>
              ))}
            </div>

            <p className="text-xs text-slate-500">
              Snapshot:{" "}
              {fmtDate(stock.stockFbaLatestSnapshotAt)} ·{" "}
              {stock.stockFbaDualPoolComplete
                ? "PAN-EU + UK completo"
                : "snapshot parcial no utilizable"}

              <span className="block text-[11px] text-slate-400">
                Fuente:{" "}
                {stock.stockFbaLatestSnapshotSource ??
                  "SP-API FBA Inventory"}
                . El stock operativo incluye unidades vendibles y
                tránsito interno entre centros Amazon. Inbound y no
                apto quedan separados.
              </span>
            </p>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            NO DISPONIBLE / SIN SNAPSHOT. El Ledger físico sigue
            visible por país, pero no sustituye el stock operativo
            actual.
          </p>
        )}

        {syncStatus ? (
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <p className="font-medium text-slate-800">
              Sincronización automática FBA
            </p>

            <p>
              Última ejecución:{" "}
              {fmtDateTime(syncStatus.lastRunAt)}
            </p>

            <p>
              {syncStatus.lastSuccessAt
                ? `Último éxito: ${fmtDateTime(
                    syncStatus.lastSuccessAt,
                  )}`
                : "Sin snapshot COMPLETE"}
            </p>

            <p>Estado: {syncStatus.lastStatus ?? "—"}</p>

            <p>
              Filas actualizadas:{" "}
              {fmtNum(syncStatus.lastRowsUpserted)}
            </p>

            {syncStatus.nextRunHint ? (
              <p>
                Próxima ejecución: {syncStatus.nextRunHint}
              </p>
            ) : null}

            {syncStatus.lastError ? (
              <p className="mt-1 text-rose-700">
                Error: {syncStatus.lastError}
              </p>
            ) : null}
          </div>
        ) : null}

        <p>
          <span className="text-slate-500">FBM: </span>

          <span className="font-semibold">
            {stock.stockOperationalFbm == null
              ? "Pendiente de sincronización"
              : `${fmtNum(stock.stockOperationalFbm)} uds`}
          </span>
        </p>

        <p>
          <span className="text-slate-500">
            {stock.stockOperationalTotal == null
              ? "Total FBA operativo: "
              : "Total operativo (forecast ALL/ALL): "}
          </span>

          <span className="font-semibold text-slate-900">
            {fmtNum(
              stock.stockOperationalTotal ??
                stock.stockOperationalFba,
            )}{" "}
            uds
          </span>
        </p>

        <p className="text-xs text-slate-500">
          Stock por país (inventario_paises):{" "}
          {countrySummary || "—"}
        </p>

        {stock.stockFbaLatestLedger != null &&
        stock.stockFbaLatestLedgerDate ? (
          <p className="text-xs text-slate-500">
            Referencia ledger FBA:{" "}
            {fmtNum(stock.stockFbaLatestLedger)} uds ·{" "}
            {fmtDate(stock.stockFbaLatestLedgerDate)}

            <span className="block text-[11px] text-slate-400">
              Solo auditoría; no es el stock FBA operativo actual.
            </span>
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            Sin referencia ledger FBA importada.
          </p>
        )}

        {stock.stockFbaDiscrepancy ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
            {stock.discrepancyMessage}
          </p>
        ) : null}
      </div>
    </Card>
  );
}