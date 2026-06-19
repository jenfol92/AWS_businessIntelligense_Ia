"use client";

import React, { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle,
  FileSpreadsheet,
  Globe2,
  Loader2,
} from "lucide-react";
import type {
  FbaCountryCommitResponse,
  FbaCountryPreviewResponse,
} from "@/modules/imports/amazon-fba-inventory-by-country/types";
import { SpApiFbaCountrySection } from "@/modules/imports/components/SpApiFbaCountrySection";

type PreviewState = FbaCountryPreviewResponse | null;
type CommitState = FbaCountryCommitResponse | null;

const UNLINKED_SKUS_DISPLAY_LIMIT = 20;
const DEFAULT_PAIS_OPTIONS = ["", "DE", "ES", "FR", "GB", "IT", "PL", "SE"];

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

export function AmazonFbaInventoryByCountryImportCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [commitResult, setCommitResult] = useState<CommitState>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);
  const [skipUnlinkedProducts, setSkipUnlinkedProducts] = useState(true);
  const [defaultPais, setDefaultPais] = useState("");

  const displayStats = useMemo(() => {
    if (!preview) return null;
    return computeImportStats(
      preview.validRows,
      preview.skippedUnlinkedRows,
      skipUnlinkedProducts,
    );
  }, [preview, skipUnlinkedProducts]);

  function buildApiUrl() {
    const base = "/api/imports/amazon-fba-inventory-by-country";
    if (!defaultPais) return base;
    return `${base}?pais=${encodeURIComponent(defaultPais)}`;
  }

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
      formData.append("source", "amazon_fba_country_report");
      formData.append("skipUnlinkedProducts", String(skipUnlinkedProducts));
      if (defaultPais) formData.append("pais", defaultPais);

      const res = await fetch(buildApiUrl(), {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Error en la importación.");
      }

      if (mode === "preview") {
        setPreview(data as FbaCountryPreviewResponse);
      } else {
        setCommitResult(data as FbaCountryCommitResponse);
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
        <div className="rounded-lg bg-violet-50 p-2 text-violet-700">
          <Globe2 className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-900">
            Importar FBA Multi-Country Inventory
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Actualiza el stock FBA por país/marketplace usando el informe{" "}
            <code className="rounded bg-slate-100 px-1">
              GET_AFN_INVENTORY_DATA_BY_COUNTRY
            </code>
            . Escribe en{" "}
            <code className="rounded bg-slate-100 px-1">
              inventario_paises.stock_fba
            </code>{" "}
            (UI Stock por país). No acepta FBA Inventory Ledger.
          </p>
        </div>
      </div>

      <SpApiFbaCountrySection />

      <div className="mt-6 border-t border-slate-200 pt-5">
        <h3 className="text-sm font-medium text-slate-800">
          Importación manual (CSV/TXT)
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          Alternativa si descargas el informe BY_COUNTRY manualmente desde Seller
          Central.
        </p>
      </div>

      <div className="mt-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">
            <span className="mb-1 block text-xs font-medium text-slate-500">
              País por defecto (si el archivo no trae columna país)
            </span>
            <select
              value={defaultPais}
              onChange={(e) => setDefaultPais(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {DEFAULT_PAIS_OPTIONS.map((code) => (
                <option key={code || "auto"} value={code}>
                  {code || "Detectar del archivo"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
            checked={skipUnlinkedProducts}
            onChange={(e) => setSkipUnlinkedProducts(e.target.checked)}
          />
          <span>Omitir SKUs sin producto vinculado</span>
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
              "Importar stock FBA por país"
            )}
          </button>
        </div>
      </div>

      {error ? (
        <div
          className={`mt-4 flex items-start gap-2 rounded-lg border px-3 py-3 text-sm ${
            error.includes("FBA Inventory Ledger")
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-rose-200 bg-rose-50 text-rose-800"
          }`}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="whitespace-pre-line">{error}</div>
        </div>
      ) : null}

      {commitResult ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p>
              <strong>inventario_paises</strong> actualizado:{" "}
              {commitResult.inventarioPaisesUpserted.toLocaleString("es-ES")}{" "}
              filas producto+país.
              {commitResult.historySnapshotsUpserted > 0 ? (
                <>
                  {" "}
                  Histórico:{" "}
                  {commitResult.historySnapshotsUpserted.toLocaleString("es-ES")}{" "}
                  snapshots.
                </>
              ) : null}
            </p>
            {commitResult.dateRange.from && commitResult.dateRange.to ? (
              <p className="text-xs">
                Snapshot: {commitResult.dateRange.from} →{" "}
                {commitResult.dateRange.to}
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
            <Stat label="Filas válidas" value={preview.validRows} />
            <Stat label="Importables" value={displayStats.importableRows} />
            <Stat label="Sin país" value={preview.skippedNoCountryRows} />
            <Stat label="Sin stock vendible" value={preview.skippedNoStockRows} />
            <Stat label="Sin producto" value={preview.skippedUnlinkedRows} />
          </div>

          {preview.rowsByCountry.length > 0 ? (
            <SummaryTable
              title="Por país"
              columns={[
                { key: "key", label: "País" },
                { key: "rows", label: "Filas" },
                { key: "stockFba", label: "Stock FBA Σ" },
              ]}
              rows={preview.rowsByCountry.map((m) => ({
                key: m.key,
                rows: m.rows.toLocaleString("es-ES"),
                stockFba: m.stockFba.toLocaleString("es-ES"),
              }))}
            />
          ) : null}

          {preview.unlinkedSkus.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-slate-800">
                SKUs sin producto vinculado
              </h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-amber-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-amber-50 text-amber-900">
                    <tr>
                      <th className="px-3 py-2">SKU</th>
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
                          <td className="px-3 py-2">{item.rows}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {preview.sampleRows.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-slate-800">Muestra</h3>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">MSKU</th>
                      <th className="px-3 py-2">País</th>
                      <th className="px-3 py-2">Stock FBA</th>
                      <th className="px-3 py-2">Producto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row) => (
                      <tr
                        key={`${row.snapshotDate}-${row.skuOriginal}-${row.pais}`}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2">{row.snapshotDate}</td>
                        <td className="px-3 py-2 font-mono">{row.skuOriginal}</td>
                        <td className="px-3 py-2">{row.pais}</td>
                        <td className="px-3 py-2">{row.stockFba}</td>
                        <td className="px-3 py-2">
                          {row.productLinked ? "Sí" : "No"}
                        </td>
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
  columns,
  rows,
}: {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string>>;
}) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-800">{title}</h3>
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
