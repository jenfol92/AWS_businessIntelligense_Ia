"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  FileSpreadsheet,
  Loader2,
  ShoppingCart,
} from "lucide-react";
import type {
  AmazonAllOrdersCommitResponse,
  AmazonAllOrdersPreviewResponse,
} from "@/modules/imports/amazon-all-orders/types";

type PreviewState = AmazonAllOrdersPreviewResponse | null;
type CommitState = AmazonAllOrdersCommitResponse | null;

const UNLINKED_SKUS_DISPLAY_LIMIT = 20;

function computeImportStats(
  validRows: number,
  skippedUnlinkedRows: number,
  skipUnlinkedProducts: boolean,
) {
  if (skipUnlinkedProducts) {
    return {
      importableRows: validRows - skippedUnlinkedRows,
      omittedUnlinkedRows: skippedUnlinkedRows,
    };
  }
  return {
    importableRows: validRows,
    omittedUnlinkedRows: 0,
  };
}

export function AmazonAllOrdersImportCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [commitResult, setCommitResult] = useState<CommitState>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);
  const [skipUnlinkedProducts, setSkipUnlinkedProducts] = useState(true);

  const displayStats = useMemo(() => {
    if (!preview) return null;
    return computeImportStats(
      preview.validRows,
      preview.skippedUnlinkedRows,
      skipUnlinkedProducts,
    );
  }, [preview, skipUnlinkedProducts]);

  async function runImport(mode: "preview" | "commit") {
    if (!file) {
      setError("Selecciona un archivo primero.");
      return;
    }

    setError(null);
    if (mode === "preview") {
      setLoadingPreview(true);
      setCommitResult(null);
    } else {
      setLoadingCommit(true);
    }

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", mode);
      formData.append("source", "amazon_all_orders_manual");
      formData.append("skipUnlinkedProducts", String(skipUnlinkedProducts));

      const res = await fetch("/api/imports/amazon-all-orders", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        const err = new Error(data.error ?? "Error en la importación.");
        if (data.code === "WRONG_REPORT_TYPE") {
          (err as Error & { code?: string; detectedType?: string }).code =
            data.code;
          (err as Error & { detectedType?: string }).detectedType =
            data.detectedType;
        }
        throw err;
      }

      if (mode === "preview") {
        setPreview(data as AmazonAllOrdersPreviewResponse);
      } else {
        setCommitResult(data as AmazonAllOrdersCommitResponse);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setLoadingPreview(false);
      setLoadingCommit(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-blue-50 p-2 text-blue-700">
          <ShoppingCart className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-900">
            Importar Amazon All Orders
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Importa pedidos de Amazon para alimentar{" "}
            <code className="rounded bg-slate-100 px-1">ventas_diarias</code> y
            forecast OWN_SALES. Solo SKUs Twinly (
            <code className="rounded bg-slate-100 px-1">843661661XXXX</code>).
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
            checked={skipUnlinkedProducts}
            onChange={(e) => setSkipUnlinkedProducts(e.target.checked)}
          />
          <span>
            <span className="font-medium text-slate-900">
              Omitir SKUs sin producto vinculado
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              Recomendado. Evita importar histórico de productos antiguos o no
              creados en catálogo.
            </span>
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
            <FileSpreadsheet className="h-4 w-4" />
            {file ? file.name : "Elegir .txt / .csv"}
            <input
              ref={inputRef}
              type="file"
              accept=".txt,.csv,text/plain,text/csv"
              className="hidden"
              onChange={(e) => {
                const next = e.target.files?.[0] ?? null;
                setFile(next);
                setPreview(null);
                setCommitResult(null);
                setError(null);
              }}
            />
          </label>

          <button
            type="button"
            disabled={!file || loadingPreview || loadingCommit}
            onClick={() => runImport("preview")}
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {loadingPreview ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Analizando…
              </span>
            ) : (
              "Vista previa"
            )}
          </button>

          <button
            type="button"
            disabled={!file || !preview || loadingPreview || loadingCommit}
            onClick={() => runImport("commit")}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {loadingCommit ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Importando…
              </span>
            ) : (
              "Importar"
            )}
          </button>
        </div>
      </div>

      {error ? (
        <div
          className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-3 text-sm ${
            error.startsWith("Archivo incorrecto") ||
            error.includes("FBA Inventory Ledger") ||
            error.includes("no parece un informe Amazon All Orders")
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1 whitespace-pre-line">{error}</div>
        </div>
      ) : null}

      {commitResult ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p>
              Importación completada. Filas leídas:{" "}
              <strong>{commitResult.totalRows.toLocaleString("es-ES")}</strong>
              . Importadas a staging:{" "}
              <strong>
                {commitResult.stagingInsertedOrUpdated.toLocaleString("es-ES")}
              </strong>
              .{" "}
              <strong>ventas_diarias</strong> actualizadas:{" "}
              <strong>
                {commitResult.ventasDiariasUpserted.toLocaleString("es-ES")}
              </strong>{" "}
              filas agregadas.
            </p>
            {commitResult.dateRange.from && commitResult.dateRange.to ? (
              <p className="text-xs text-emerald-800">
                Rango importado: {commitResult.dateRange.from} →{" "}
                {commitResult.dateRange.to}
              </p>
            ) : null}
            {commitResult.rowsByMarketplace.length > 0 ? (
              <p className="text-xs text-emerald-800">
                Marketplaces:{" "}
                {commitResult.rowsByMarketplace
                  .map((m) => `${m.key} (${m.rows})`)
                  .join(" · ")}
              </p>
            ) : null}
            {commitResult.notFoundRows > 0 ? (
              <p className="text-xs text-emerald-800">
                Productos no encontrados:{" "}
                <strong>
                  {commitResult.notFoundRows.toLocaleString("es-ES")}
                </strong>{" "}
                filas omitidas.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {preview && displayStats ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Filas archivo" value={preview.totalRows} />
            <Stat label="Filas Twinly" value={preview.twinlyRows} />
            <Stat label="Filas válidas detectadas" value={preview.validRows} />
            <Stat
              label="Filas que se importarían"
              value={displayStats.importableRows}
            />
            <Stat
              label="Descartadas (no Twinly)"
              value={preview.skippedNonTwinlyRows}
            />
            <Stat
              label="Descartadas (canceladas)"
              value={preview.skippedCancelledRows}
            />
            <Stat
              label="Descartadas (qty ≤ 0)"
              value={preview.skippedQuantityZeroRows}
            />
            <Stat
              label="Sin producto"
              value={preview.skippedUnlinkedRows}
            />
            <Stat
              label="Omitidas por no tener producto"
              value={displayStats.omittedUnlinkedRows}
            />
            <Stat label="SKUs únicos" value={preview.uniqueSkus} />
            <Stat
              label="Rango fechas"
              value={
                preview.dateRange.from && preview.dateRange.to
                  ? `${preview.dateRange.from} → ${preview.dateRange.to}`
                  : "—"
              }
            />
          </div>

          {preview.rowsByMonth.length > 0 ? (
            <SummaryTable
              title="Resumen por mes"
              subtitle="Filas importables (con producto si la opción está activa)."
              columns={[
                { key: "month", label: "Mes" },
                { key: "rows", label: "Filas" },
                { key: "uniqueSkus", label: "SKUs únicos" },
              ]}
              rows={preview.rowsByMonth.map((m) => ({
                month: m.month,
                rows: m.rows.toLocaleString("es-ES"),
                uniqueSkus: m.uniqueSkus.toLocaleString("es-ES"),
              }))}
            />
          ) : null}

          {preview.rowsByMarketplace.length > 0 ? (
            <SummaryTable
              title="Por marketplace"
              subtitle="País derivado de sales-channel."
              columns={[
                { key: "key", label: "País" },
                { key: "rows", label: "Filas" },
              ]}
              rows={preview.rowsByMarketplace.map((m) => ({
                key: m.key,
                rows: m.rows.toLocaleString("es-ES"),
              }))}
            />
          ) : null}

          {preview.rowsByChannel.length > 0 ? (
            <SummaryTable
              title="Por canal"
              subtitle="FBA / FBM / AMAZON según fulfillment-channel."
              columns={[
                { key: "key", label: "Canal" },
                { key: "rows", label: "Filas" },
              ]}
              rows={preview.rowsByChannel.map((m) => ({
                key: m.key,
                rows: m.rows.toLocaleString("es-ES"),
              }))}
            />
          ) : null}

          {preview.unlinkedSkus.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-slate-800">
                SKUs Twinly sin producto vinculado
              </h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-amber-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-amber-50 text-amber-900">
                    <tr>
                      <th className="px-3 py-2">SKU limpio</th>
                      <th className="px-3 py-2">Filas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.unlinkedSkus
                      .slice(0, UNLINKED_SKUS_DISPLAY_LIMIT)
                      .map((item) => (
                        <tr
                          key={item.skuLimpio}
                          className="border-t border-amber-100"
                        >
                          <td className="px-3 py-2 font-mono">{item.skuLimpio}</td>
                          <td className="px-3 py-2">
                            {item.rows.toLocaleString("es-ES")}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {preview.sampleRows.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-slate-800">
                Muestra de filas válidas detectadas
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Muestra distribuida por fechas. La importación guardará{" "}
                <strong>{displayStats.importableRows.toLocaleString("es-ES")}</strong>{" "}
                líneas en staging y agregará ventas diarias desde ahí.
              </p>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">MSKU</th>
                      <th className="px-3 py-2">SKU limpio</th>
                      <th className="px-3 py-2">Producto</th>
                      <th className="px-3 py-2">Qty</th>
                      <th className="px-3 py-2">Precio</th>
                      <th className="px-3 py-2">Sales channel</th>
                      <th className="px-3 py-2">País</th>
                      <th className="px-3 py-2">Canal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row) => (
                      <tr
                        key={`${row.purchaseDate}-${row.skuOriginal}-${row.quantity}`}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2">{row.purchaseDate}</td>
                        <td className="px-3 py-2 font-mono">{row.skuOriginal}</td>
                        <td className="px-3 py-2 font-mono">{row.skuLimpio}</td>
                        <td className="px-3 py-2">
                          {row.productLinked ? "Sí" : "No"}
                        </td>
                        <td className="px-3 py-2">{row.quantity}</td>
                        <td className="px-3 py-2">{row.itemPrice}</td>
                        <td className="px-3 py-2">{row.salesChannel ?? "—"}</td>
                        <td className="px-3 py-2">{row.marketplaceCountry}</td>
                        <td className="px-3 py-2">{row.canalVenta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function SummaryTable({
  title,
  subtitle,
  columns,
  rows,
}: {
  title: string;
  subtitle: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string>>;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-800">{title}</h3>
      <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {columns.map((col) => (
                <th key={col.key} className="px-3 py-2">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={Object.values(row).join("-")}
                className="border-t border-slate-100"
              >
                {columns.map((col) => (
                  <td key={col.key} className="px-3 py-2">
                    {row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
