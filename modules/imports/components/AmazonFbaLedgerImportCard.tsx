"use client";

import React, { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CheckCircle,
  FileSpreadsheet,
  Loader2,
  Package,
  RefreshCw,
} from "lucide-react";
import type {
  AmazonFbaLedgerCommitResponse,
  AmazonFbaLedgerPreviewResponse,
} from "@/modules/imports/amazon-fba-ledger-summary/types";

type PreviewState = AmazonFbaLedgerPreviewResponse | null;
type CommitState = AmazonFbaLedgerCommitResponse | null;
type SpApiLedgerRunState = {
  ok: boolean;
  status?: string;
  processingStatus?: string | null;
  jobId?: string | null;
  reportId?: string | null;
  reportDocumentId?: string | null;
  dataStartTime?: string | null;
  dataEndTime?: string | null;
  requestedCreateReportPayload?: Record<string, unknown>;
  imported?: AmazonFbaLedgerCommitResponse | null;
  commit?: AmazonFbaLedgerCommitResponse | null;
  error?: string | null;
} | null;

const UNLINKED_SKUS_DISPLAY_LIMIT = 20;

function computeImportStats(
  validRows: number,
  unlinkedProductRows: number,
  conflictRows: number,
  skipUnlinkedProducts: boolean,
) {
  const rowsAfterConflicts = Math.max(validRows - conflictRows, 0);
  if (skipUnlinkedProducts) {
    return {
      importableRows: Math.max(rowsAfterConflicts - unlinkedProductRows, 0),
      omittedUnlinkedRows: unlinkedProductRows,
    };
  }
  return {
    importableRows: rowsAfterConflicts,
    omittedUnlinkedRows: 0,
  };
}

export function AmazonFbaLedgerImportCard() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [commitResult, setCommitResult] = useState<CommitState>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);
  const [loadingSpApiLedger, setLoadingSpApiLedger] = useState(false);
  const [spApiLedgerStage, setSpApiLedgerStage] = useState<string | null>(null);
  const [spApiLedgerResult, setSpApiLedgerResult] = useState<SpApiLedgerRunState>(null);
  const [skipUnlinkedProducts, setSkipUnlinkedProducts] = useState(true);

  const displayStats = useMemo(() => {
    if (!preview) return null;
    return computeImportStats(
      preview.validRows,
      preview.unlinkedProductRows,
      preview.conflictRows,
      skipUnlinkedProducts,
    );
  }, [preview, skipUnlinkedProducts]);
  const commitBlocked =
    preview != null && (preview.warnings.length > 0 || preview.conflictRows > 0);

  async function runImport(mode: "preview" | "commit") {
    if (!file) {
      setError("Selecciona un archivo CSV primero.");
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
      formData.append("source", "amazon_fba_ledger_summary_manual");
      formData.append("skipUnlinkedProducts", String(skipUnlinkedProducts));

      const res = await fetch("/api/imports/amazon-fba-ledger-summary", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "Error en la importación.");
      }

      if (mode === "preview") {
        setPreview(data as AmazonFbaLedgerPreviewResponse);
      } else {
        setCommitResult(data as AmazonFbaLedgerCommitResponse);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setLoadingPreview(false);
      setLoadingCommit(false);
    }
  }

  async function runSpApiLedger() {
    setError(null);
    setSpApiLedgerResult(null);
    setLoadingSpApiLedger(true);
    setSpApiLedgerStage("solicitado");

    try {
      const requestRes = await fetch("/api/amazon/sp-api/reports/fba-ledger/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "request" }),
      });
      const requested = await requestRes.json();
      if (!requestRes.ok || !requested.ok || !requested.jobId) {
        throw new Error(requested.error ?? "Error solicitando Inventory Ledger diario.");
      }
      setSpApiLedgerResult(requested as SpApiLedgerRunState);

      let polled = requested as NonNullable<SpApiLedgerRunState>;
      for (let attempt = 0; attempt < 24; attempt++) {
        setSpApiLedgerStage(`procesando ${attempt + 1}/24`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const pollRes = await fetch("/api/amazon/sp-api/reports/fba-ledger/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "poll", jobId: requested.jobId }),
        });
        polled = await pollRes.json();
        if (!pollRes.ok || !polled.ok) {
          throw new Error(polled.error ?? "Error comprobando estado del Ledger.");
        }
        setSpApiLedgerResult(polled);
        if (polled.processingStatus === "DONE" || polled.status === "DONE") break;
        if (polled.status === "FATAL" || polled.status === "CANCELLED") {
          throw new Error(`Amazon devolvio estado ${polled.status}.`);
        }
      }

      if (polled.processingStatus !== "DONE" && polled.status !== "DONE") {
        throw new Error("Amazon aun no ha cerrado el Ledger. Reintenta en unos minutos.");
      }

      setSpApiLedgerStage("descargando e importando");
      const commitRes = await fetch("/api/amazon/sp-api/reports/fba-ledger/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "commit", jobId: requested.jobId }),
      });
      const committed = await commitRes.json();
      if (!commitRes.ok || !committed.ok) {
        throw new Error(committed.error ?? "Error importando Inventory Ledger diario.");
      }
      setSpApiLedgerStage("importado");
      setSpApiLedgerResult({
        ...committed,
        imported: committed.commit,
      } as SpApiLedgerRunState);
      router.refresh();
    } catch (err: unknown) {
      setSpApiLedgerStage("fallido");
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setLoadingSpApiLedger(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-orange-50 p-2 text-orange-700">
          <Package className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-slate-900">
            Amazon FBA Ledger Summary
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Stock FBA <strong>total operativo</strong> y histórico global (
            <code className="rounded bg-slate-100 px-1">
              v_product_fba_stock_daily
            </code>
            ). Usado por forecast ALL/ALL.{" "}
            <span className="text-slate-500">
              No actualiza stock por país en inventario_paises.
            </span>
          </p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-orange-100 bg-orange-50 px-3 py-3">
          <button
            type="button"
            disabled={loadingPreview || loadingCommit || loadingSpApiLedger}
            onClick={runSpApiLedger}
            className="inline-flex items-center gap-2 rounded-lg bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-50"
          >
            {loadingSpApiLedger ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Actualizar Inventory Ledger diario
          </button>
          {spApiLedgerStage ? (
            <span className="text-sm font-medium text-orange-900">
              Estado: {spApiLedgerStage}
            </span>
          ) : null}
        </div>

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
            {file ? file.name : "Elegir CSV"}
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
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
            disabled={!file || !preview || commitBlocked || loadingPreview || loadingCommit}
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
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {commitResult ? (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Importación completada. Se han insertado/actualizado{" "}
            <strong>{commitResult.insertedOrUpdated.toLocaleString("es-ES")}</strong>{" "}
            filas.
            {commitResult.omittedUnlinkedRows > 0 ? (
              <>
                {" "}
                Se han omitido{" "}
                <strong>
                  {commitResult.omittedUnlinkedRows.toLocaleString("es-ES")}
                </strong>{" "}
                filas sin producto vinculado.
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {spApiLedgerResult?.imported ? (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <div className="flex items-start gap-2">
            <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Ledger diario importado. Fecha solicitada:{" "}
              <strong>{String(spApiLedgerResult.dataStartTime ?? "").slice(0, 10)}</strong>.
              Filas insertadas/actualizadas:{" "}
              <strong>
                {spApiLedgerResult.imported.insertedOrUpdated.toLocaleString("es-ES")}
              </strong>
              .
            </div>
          </div>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
            <span>Report ID: {spApiLedgerResult.reportId ?? "-"}</span>
            <span>
              Conflictos matching: {spApiLedgerResult.imported.conflictRows}
            </span>
            <span>
              FNSKU sin condicion: {spApiLedgerResult.imported.unknownConditionRows}
            </span>
          </div>
        </div>
      ) : null}

      {preview && displayStats ? (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Filas CSV" value={preview.totalRows} />
            <Stat label="Filas Twinly" value={preview.twinlyRows} />
            <Stat
              label="Filas válidas detectadas"
              value={preview.validRows}
            />
            <Stat
              label="Filas que se importarían"
              value={displayStats.importableRows}
            />
            <Stat label="Conflictos matching" value={preview.conflictRows} />
            <Stat label="Condicion UNKNOWN" value={preview.unknownConditionRows} />
            <Stat label="SKUs únicos" value={preview.uniqueSkus} />
            <Stat
              label="Filas sin producto"
              value={preview.unlinkedProductRows}
            />
            <Stat
              label="Filas omitidas por no tener producto"
              value={displayStats.omittedUnlinkedRows}
            />
            <Stat
              label="Descartadas (no Twinly)"
              value={preview.skippedNonTwinlyRows}
            />
            <Stat label="Descartadas (otras)" value={preview.skippedRows} />
            <Stat
              label="Rango fechas"
              value={
                preview.dateRange.from && preview.dateRange.to
                  ? `${preview.dateRange.from} → ${preview.dateRange.to}`
                  : "—"
              }
            />
          </div>

          {commitBlocked ? (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Commit bloqueado: resuelve{" "}
                <strong>{preview.warnings.length.toLocaleString("es-ES")}</strong>{" "}
                warnings y{" "}
                <strong>{preview.conflictRows.toLocaleString("es-ES")}</strong>{" "}
                conflictos de matching antes de importar.
              </span>
            </div>
          ) : null}

          {preview.rowsByMonth.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-slate-800">
                Resumen por mes
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Filas válidas Twinly detectadas en el CSV (antes de omitir SKUs
                sin producto).
              </p>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Mes</th>
                      <th className="px-3 py-2">Filas</th>
                      <th className="px-3 py-2">SKUs únicos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rowsByMonth.map((m) => (
                      <tr
                        key={m.month}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2 font-mono">{m.month}</td>
                        <td className="px-3 py-2">
                          {m.rows.toLocaleString("es-ES")}
                        </td>
                        <td className="px-3 py-2">
                          {m.uniqueSkus.toLocaleString("es-ES")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {preview.dispositions.length > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <div>
                <span className="font-medium text-slate-800">Dispositions:</span>{" "}
                {preview.dispositions.join(", ")}
              </div>
              <p className="mt-2 text-xs text-slate-600">
                <strong className="text-slate-700">SELLABLE + NEWITEM</strong>{" "}
                entra en FBA nuevo vendible. SELLABLE usado queda separado,
                condition UNKNOWN queda visible y separada, pero no entra en FBA
                nuevo vendible. Cualquier disposition distinta de SELLABLE se
                registra como no apta para stock principal.
              </p>
            </div>
          ) : null}

          {preview.locations.length > 0 ? (
            <div className="text-sm text-slate-600">
              <span className="font-medium text-slate-800">Locations:</span>{" "}
              {preview.locations.slice(0, 30).join(", ")}
              {preview.locations.length > 30
                ? ` (+${preview.locations.length - 30} más)`
                : ""}
            </div>
          ) : null}

          {preview.unlinkedSkus.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-slate-800">
                SKUs Twinly sin producto vinculado
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {skipUnlinkedProducts
                  ? "Con la opción activa, las filas de estos SKUs no se importarán."
                  : "Con la opción desactivada, estas filas se importarán con producto_id = null."}{" "}
                Revisa si faltan en catálogo o si{" "}
                <code className="rounded bg-slate-100 px-1">productos.sku</code>{" "}
                no coincide con el SKU limpio.
              </p>
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
              {preview.unlinkedSkus.length > UNLINKED_SKUS_DISPLAY_LIMIT ? (
                <p className="mt-1 text-xs text-slate-500">
                  Mostrando {UNLINKED_SKUS_DISPLAY_LIMIT} de{" "}
                  {preview.unlinkedSkus.length} SKUs sin producto.
                </p>
              ) : null}
            </div>
          ) : null}

          {preview.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="font-medium">
                Avisos ({preview.warnings.length})
              </div>
              <ul className="mt-1 list-disc pl-5">
                {preview.warnings.slice(0, 8).map((w) => (
                  <li key={`${w.row}-${w.message}`}>
                    Fila {w.row}: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.sampleRows.length > 0 ? (
            <div>
              <h3 className="text-sm font-medium text-slate-800">
                Muestra de filas válidas detectadas
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                No son todas las filas del archivo. Es una muestra distribuida
                por fechas (inicio, medio y fin del rango).
              </p>
              <p className="mt-1 text-xs text-slate-600">
                La importación guardará{" "}
                <strong>{displayStats.importableRows.toLocaleString("es-ES")}</strong>{" "}
                filas
                {skipUnlinkedProducts && displayStats.omittedUnlinkedRows > 0
                  ? ` (omitiendo ${displayStats.omittedUnlinkedRows.toLocaleString("es-ES")} sin producto vinculado)`
                  : ""}
                .
              </p>
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">MSKU</th>
                      <th className="px-3 py-2">SKU limpio</th>
                      <th className="px-3 py-2">ASIN</th>
                      <th className="px-3 py-2">Disposition</th>
                      <th className="px-3 py-2">Ending</th>
                      <th className="px-3 py-2">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row) => (
                      <tr
                        key={`${row.snapshotDate}-${row.skuOriginal}-${row.disposition}-${row.location}`}
                        className="border-t border-slate-100"
                      >
                        <td className="px-3 py-2">{row.snapshotDate}</td>
                        <td className="px-3 py-2 font-mono">{row.skuOriginal}</td>
                        <td className="px-3 py-2 font-mono">{row.skuLimpio}</td>
                        <td className="px-3 py-2">{row.asin ?? "—"}</td>
                        <td className="px-3 py-2">{row.disposition ?? "—"}</td>
                        <td className="px-3 py-2">{row.endingWarehouseBalance}</td>
                        <td className="px-3 py-2">{row.location ?? "—"}</td>
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
