"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { FORECAST_METHODS, type ForecastMethod } from "@/modules/planning/types";
import type { ProductBenchmarkCompetitorRow } from "../types/competitor-benchmark-selection.types";
import {
  fetchProductBenchmarkCompetitors,
  fetchProductForecastConfig,
  saveProductBenchmarkSelection,
  saveProductForecastConfig,
  type ProductForecastConfigFormState,
} from "../services/productBenchmarkClient";
import { ResponsiveDataCard } from "@/shared/ui/ResponsiveDataCard";
import { ResponsiveTable } from "@/shared/ui/ResponsiveTable";
import {
  pfCard,
  pfCardBody,
  pfCardHeader,
  pfCardSubtitle,
  pfCardTitle,
  pfControl,
  pfFieldClass,
  pfGrid,
  pfLabel,
  pfSpan2,
} from "./form/productFormUi";

const FORECAST_METHOD_LABELS: Record<ForecastMethod, string> = {
  AUTO: "AUTO — automático (ventas o benchmark)",
  OWN_SALES: "OWN_SALES — solo ventas propias",
  OWN_SALES_CORRECTED: "OWN_SALES_CORRECTED — ventas corregidas por rotura",
  COMPETITOR_BENCHMARK: "COMPETITOR_BENCHMARK — solo competidores",
  MIXED: "MIXED — mezcla ventas + competidores",
  MANUAL: "MANUAL — forecast manual",
};

type EditableCompetitorRow = ProductBenchmarkCompetitorRow;

type Props = {
  productId: string;
  defaultMarketplaceCountry?: string;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("es-ES");
}

function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-ES", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("es-ES", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
}

function parseOptionalDecimal(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n;
}

function medianPositive(values: number[]): number | null {
  const filtered = values.filter((v) => v > 0);
  if (filtered.length === 0) return null;
  const sorted = [...filtered].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function meanPositive(values: number[]): number | null {
  const filtered = values.filter((v) => v > 0);
  if (filtered.length === 0) return null;
  return filtered.reduce((s, v) => s + v, 0) / filtered.length;
}

function serializeCompetitors(rows: EditableCompetitorRow[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      competitorAsin: r.competitorAsin,
      isSelected: r.isSelected,
      useForForecast: r.useForForecast,
      weight: r.weight,
      capturePct: r.capturePct,
      notes: r.notes,
    })),
  );
}

function serializeForecastConfig(config: ProductForecastConfigFormState): string {
  return JSON.stringify(config);
}

function assertRange(value: number | null, label: string): string | null {
  if (value == null) return null;
  if (value < 0 || value > 1) {
    return `${label} debe estar entre 0 y 1.`;
  }
  return null;
}

export function ProductBenchmarkingPanel({
  productId,
  defaultMarketplaceCountry = "ES",
}: Props) {
  const marketplaceCountry = defaultMarketplaceCountry.trim() || "ES";

  const [competitors, setCompetitors] = useState<EditableCompetitorRow[]>([]);
  const [savedCompetitorsSnapshot, setSavedCompetitorsSnapshot] = useState("");
  const [loadingCompetitors, setLoadingCompetitors] = useState(true);
  const [competitorsError, setCompetitorsError] = useState<string | null>(null);

  const [forecastConfig, setForecastConfig] =
    useState<ProductForecastConfigFormState | null>(null);
  const [savedForecastSnapshot, setSavedForecastSnapshot] = useState("");
  const [loadingForecast, setLoadingForecast] = useState(true);
  const [forecastError, setForecastError] = useState<string | null>(null);

  const [savingSelection, setSavingSelection] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [selectionMessageError, setSelectionMessageError] = useState(false);

  const [savingForecast, setSavingForecast] = useState(false);
  const [forecastMessage, setForecastMessage] = useState<string | null>(null);
  const [forecastMessageError, setForecastMessageError] = useState(false);

  const loadCompetitors = useCallback(async () => {
    setLoadingCompetitors(true);
    setCompetitorsError(null);
    try {
      const data = await fetchProductBenchmarkCompetitors(
        productId,
        marketplaceCountry,
      );
      setCompetitors(data.competitors);
      setSavedCompetitorsSnapshot(serializeCompetitors(data.competitors));
    } catch (e) {
      setCompetitors([]);
      setCompetitorsError(
        e instanceof Error ? e.message : "No se pudieron cargar competidores.",
      );
    } finally {
      setLoadingCompetitors(false);
    }
  }, [marketplaceCountry, productId]);

  const loadForecast = useCallback(async () => {
    setLoadingForecast(true);
    setForecastError(null);
    try {
      const config = await fetchProductForecastConfig(productId);
      setForecastConfig(config);
      setSavedForecastSnapshot(serializeForecastConfig(config));
    } catch (e) {
      setForecastConfig(null);
      setForecastError(
        e instanceof Error
          ? e.message
          : "No se pudo cargar la configuración de forecast.",
      );
    } finally {
      setLoadingForecast(false);
    }
  }, [productId]);

  useEffect(() => {
    void loadCompetitors();
    void loadForecast();
  }, [loadCompetitors, loadForecast]);

  const selectionDirty = useMemo(
    () => serializeCompetitors(competitors) !== savedCompetitorsSnapshot,
    [competitors, savedCompetitorsSnapshot],
  );

  const forecastDirty = useMemo(
    () =>
      forecastConfig != null &&
      serializeForecastConfig(forecastConfig) !== savedForecastSnapshot,
    [forecastConfig, savedForecastSnapshot],
  );

  const summary = useMemo(() => {
    const available = competitors.length;
    const selected = competitors.filter((c) => c.isSelected).length;
    const usedInForecast = competitors.filter((c) => c.useForForecast).length;
    const forecastUnits = competitors
      .filter((c) => c.useForForecast)
      .map((c) => c.estimatedMonthlyUnits)
      .filter((u): u is number => u != null && u > 0);

    return {
      available,
      selected,
      usedInForecast,
      meanUnits: meanPositive(forecastUnits),
      medianUnits: medianPositive(forecastUnits),
    };
  }, [competitors]);

  function updateCompetitor(
    asin: string,
    patch: Partial<EditableCompetitorRow>,
  ) {
    setCompetitors((prev) =>
      prev.map((row) => {
        if (row.competitorAsin !== asin) return row;
        let next = { ...row, ...patch };
        if (patch.isSelected === false) {
          next = { ...next, useForForecast: false };
        }
        if (patch.useForForecast === true) {
          next = { ...next, isSelected: true };
        }
        return next;
      }),
    );
    setSelectionMessage(null);
  }

  async function handleSaveSelection() {
    for (const row of competitors) {
      const weightErr = assertRange(row.weight, "Peso");
      if (weightErr) {
        setSelectionMessage(weightErr);
        setSelectionMessageError(true);
        return;
      }
      const captureErr = assertRange(row.capturePct, "Captura");
      if (captureErr) {
        setSelectionMessage(captureErr);
        setSelectionMessageError(true);
        return;
      }
    }

    setSavingSelection(true);
    setSelectionMessage(null);
    setSelectionMessageError(false);

    try {
      await saveProductBenchmarkSelection(productId, {
        marketplaceCountry,
        competitors: competitors.map((row) => ({
          competitorAsin: row.competitorAsin,
          competitorTitle: row.competitorTitle,
          snapshotId: row.snapshotId,
          isSelected: row.isSelected,
          useForForecast: row.useForForecast,
          weight: row.weight,
          capturePct: row.capturePct,
          notes: row.notes,
        })),
      });
      setSavedCompetitorsSnapshot(serializeCompetitors(competitors));
      setSelectionMessage("Selección guardada correctamente.");
      setSelectionMessageError(false);
      await loadCompetitors();
    } catch (e) {
      setSelectionMessage(
        e instanceof Error ? e.message : "Error al guardar selección.",
      );
      setSelectionMessageError(true);
    } finally {
      setSavingSelection(false);
    }
  }

  async function handleSaveForecast() {
    if (!forecastConfig) return;

    const ownErr = assertRange(
      forecastConfig.forecastMixOwnWeight,
      "Peso ventas propias",
    );
    const compErr = assertRange(
      forecastConfig.forecastMixCompetitorWeight,
      "Peso competidores",
    );
    const captureErr = assertRange(
      forecastConfig.competitorCapturePct,
      "Captura competidor",
    );
    const errMsg = ownErr ?? compErr ?? captureErr;
    if (errMsg) {
      setForecastMessage(errMsg);
      setForecastMessageError(true);
      return;
    }

    setSavingForecast(true);
    setForecastMessage(null);
    setForecastMessageError(false);

    try {
      const saved = await saveProductForecastConfig(productId, forecastConfig);
      setForecastConfig(saved);
      setSavedForecastSnapshot(serializeForecastConfig(saved));
      setForecastMessage("Configuración de forecast guardada correctamente.");
      setForecastMessageError(false);
    } catch (e) {
      setForecastMessage(
        e instanceof Error ? e.message : "Error al guardar configuración.",
      );
      setForecastMessageError(true);
    } finally {
      setSavingForecast(false);
    }
  }

  const loading = loadingCompetitors || loadingForecast;

  return (
    <div className="space-y-6">
      {/* Configuración forecast */}
      <section className={pfCard}>
        <div className={pfCardHeader}>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
              <BarChart3 className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className={pfCardTitle}>Configuración de forecast</h2>
              <p className={pfCardSubtitle}>
                Marketplace: {marketplaceCountry}. Define cómo se calcula la
                demanda para este producto.
              </p>
            </div>
          </div>
        </div>
        <div className={pfCardBody}>
          {loadingForecast && !forecastConfig ? (
            <p className="text-sm text-slate-500">Cargando configuración…</p>
          ) : null}

          {forecastError && !forecastConfig ? (
            <div className="space-y-3">
              <p className="text-sm text-red-700">{forecastError}</p>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => void loadForecast()}
              >
                <RefreshCw className="h-4 w-4" />
                Reintentar
              </button>
            </div>
          ) : null}

          {forecastConfig ? (
            <div className="space-y-5">
              <div className={pfGrid}>
                <div className={pfSpan2}>
                  <label className={pfLabel} htmlFor="forecastMethod">
                    Método de forecast
                  </label>
                  <select
                    id="forecastMethod"
                    className={pfFieldClass()}
                    value={forecastConfig.forecastMethod}
                    onChange={(e) =>
                      setForecastConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              forecastMethod: e.target.value as ForecastMethod,
                            }
                          : prev,
                      )
                    }
                    disabled={savingForecast}
                  >
                    {FORECAST_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {FORECAST_METHOD_LABELS[method]}
                      </option>
                    ))}
                  </select>
                  {forecastConfig.forecastMethod === "OWN_SALES_CORRECTED" ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Preparado para fase posterior de corrección por rotura de
                      stock.
                    </p>
                  ) : null}
                  {forecastConfig.forecastMethod === "MANUAL" ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Preparado para fase posterior de forecast manual.
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className={pfLabel} htmlFor="forecastMixOwnWeight">
                    Peso ventas propias (0–1)
                  </label>
                  <input
                    id="forecastMixOwnWeight"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    className={pfFieldClass()}
                    value={forecastConfig.forecastMixOwnWeight ?? ""}
                    onChange={(e) =>
                      setForecastConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              forecastMixOwnWeight: parseOptionalDecimal(
                                e.target.value,
                              ),
                            }
                          : prev,
                      )
                    }
                    disabled={savingForecast}
                    placeholder="Ej. 0.4"
                  />
                </div>

                <div>
                  <label className={pfLabel} htmlFor="forecastMixCompetitorWeight">
                    Peso competidores (0–1)
                  </label>
                  <input
                    id="forecastMixCompetitorWeight"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    className={pfFieldClass()}
                    value={forecastConfig.forecastMixCompetitorWeight ?? ""}
                    onChange={(e) =>
                      setForecastConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              forecastMixCompetitorWeight: parseOptionalDecimal(
                                e.target.value,
                              ),
                            }
                          : prev,
                      )
                    }
                    disabled={savingForecast}
                    placeholder="Ej. 0.6"
                  />
                </div>

                <div>
                  <label className={pfLabel} htmlFor="competitorCapturePct">
                    Captura competidor por defecto (0–1)
                  </label>
                  <input
                    id="competitorCapturePct"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    className={pfFieldClass()}
                    value={forecastConfig.competitorCapturePct ?? ""}
                    onChange={(e) =>
                      setForecastConfig((prev) =>
                        prev
                          ? {
                              ...prev,
                              competitorCapturePct: parseOptionalDecimal(
                                e.target.value,
                              ),
                            }
                          : prev,
                      )
                    }
                    disabled={savingForecast}
                    placeholder="Ej. 0.07 (7 %)"
                  />
                </div>

                <div className="flex items-end">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={forecastConfig.stockoutCorrectionEnabled}
                      onChange={(e) =>
                        setForecastConfig((prev) =>
                          prev
                            ? {
                                ...prev,
                                stockoutCorrectionEnabled: e.target.checked,
                              }
                            : prev,
                        )
                      }
                      disabled={savingForecast}
                    />
                    Corregir rotura de stock (fase posterior)
                  </label>
                </div>
              </div>

              {forecastMessage ? (
                <p
                  className={
                    forecastMessageError
                      ? "text-sm text-red-700"
                      : "text-sm text-green-700"
                  }
                >
                  {forecastMessage}
                </p>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  onClick={() => void handleSaveForecast()}
                  disabled={savingForecast || loadingForecast || !forecastDirty}
                >
                  {savingForecast ? "Guardando…" : "Guardar configuración"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Resumen */}
      <section className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-700">
        <p>
          Competidores disponibles: <strong>{summary.available}</strong>
          {" · "}
          Seleccionados: <strong>{summary.selected}</strong>
          {" · "}
          Usados en forecast: <strong>{summary.usedInForecast}</strong>
          {" · "}
          Método forecast:{" "}
          <strong>{forecastConfig?.forecastMethod ?? "—"}</strong>
        </p>
        {summary.usedInForecast > 0 ? (
          <p className="mt-2 text-slate-600">
            Media estimada competidores:{" "}
            <strong>
              {summary.meanUnits != null
                ? `${fmtNumber(summary.meanUnits, 0)} uds/mes`
                : "—"}
            </strong>
            {" · "}
            Mediana estimada competidores:{" "}
            <strong>
              {summary.medianUnits != null
                ? `${fmtNumber(summary.medianUnits, 0)} uds/mes`
                : "—"}
            </strong>
          </p>
        ) : null}
      </section>

      {/* Tabla competidores */}
      <section className={pfCard}>
        <div className={pfCardHeader}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className={pfCardTitle}>Competidores</h2>
              <p className={pfCardSubtitle}>
                Snapshots en {marketplaceCountry}. Marca cuáles influyen en el
                forecast.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              onClick={() => void loadCompetitors()}
              disabled={loadingCompetitors}
            >
              <RefreshCw className="h-4 w-4" />
              Recargar
            </button>
          </div>
        </div>
        <div className={pfCardBody}>
          {loadingCompetitors && competitors.length === 0 ? (
            <p className="text-sm text-slate-500">Cargando competidores…</p>
          ) : null}

          {competitorsError ? (
            <p className="text-sm text-red-700">{competitorsError}</p>
          ) : null}

          {!loadingCompetitors &&
          !competitorsError &&
          competitors.length === 0 ? (
            <p className="text-sm text-slate-600">
              No hay snapshots de competidores para este producto todavía. En la
              siguiente fase podrás importar un CSV/Excel de Helium10.
            </p>
          ) : null}

          {competitors.length > 0 ? (
            <>
              <ResponsiveTable
                desktop={
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-2 py-2">Sel.</th>
                          <th className="px-2 py-2">Forecast</th>
                          <th className="px-2 py-2">ASIN</th>
                          <th className="px-2 py-2">Título</th>
                          <th className="px-2 py-2">Precio</th>
                          <th className="px-2 py-2">Rating</th>
                          <th className="px-2 py-2">Reviews</th>
                          <th className="px-2 py-2">BSR</th>
                          <th className="px-2 py-2">Uds/mes</th>
                          <th className="px-2 py-2">Ingresos/mes</th>
                          <th className="px-2 py-2">Snapshot</th>
                          <th className="px-2 py-2">Fuente</th>
                          <th className="px-2 py-2">Peso</th>
                          <th className="px-2 py-2">Captura</th>
                          <th className="px-2 py-2">Notas</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {competitors.map((row) => (
                          <CompetitorTableRow
                            key={row.competitorAsin}
                            row={row}
                            onChange={updateCompetitor}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                }
                mobile={
                  <div className="space-y-3">
                    {competitors.map((row) => (
                      <CompetitorMobileCard
                        key={row.competitorAsin}
                        row={row}
                        onChange={updateCompetitor}
                      />
                    ))}
                  </div>
                }
              />

              {selectionMessage ? (
                <p
                  className={
                    selectionMessageError
                      ? "mt-4 text-sm text-red-700"
                      : "mt-4 text-sm text-green-700"
                  }
                >
                  {selectionMessage}
                </p>
              ) : null}

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  onClick={() => void handleSaveSelection()}
                  disabled={savingSelection || loading || !selectionDirty}
                >
                  {savingSelection ? "Guardando…" : "Guardar selección"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

type RowProps = {
  row: EditableCompetitorRow;
  onChange: (asin: string, patch: Partial<EditableCompetitorRow>) => void;
};

function CompetitorTableRow({ row, onChange }: RowProps) {
  return (
    <tr className="align-top text-slate-800">
      <td className="px-2 py-2">
        <input
          type="checkbox"
          checked={row.isSelected}
          onChange={(e) =>
            onChange(row.competitorAsin, { isSelected: e.target.checked })
          }
          aria-label={`Seleccionar ${row.competitorAsin}`}
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="checkbox"
          checked={row.useForForecast}
          disabled={!row.isSelected && !row.useForForecast}
          onChange={(e) =>
            onChange(row.competitorAsin, { useForForecast: e.target.checked })
          }
          aria-label={`Usar en forecast ${row.competitorAsin}`}
        />
      </td>
      <td className="px-2 py-2 font-mono text-xs">{row.competitorAsin}</td>
      <td className="max-w-[12rem] px-2 py-2 text-xs">{row.competitorTitle ?? "—"}</td>
      <td className="px-2 py-2">{fmtMoney(row.price)}</td>
      <td className="px-2 py-2">{fmtNumber(row.rating, 1)}</td>
      <td className="px-2 py-2">{fmtNumber(row.reviewCount, 0)}</td>
      <td className="px-2 py-2">{fmtNumber(row.bsr, 0)}</td>
      <td className="px-2 py-2">{fmtNumber(row.estimatedMonthlyUnits, 0)}</td>
      <td className="px-2 py-2">{fmtMoney(row.estimatedMonthlyRevenue)}</td>
      <td className="px-2 py-2 text-xs">{fmtDate(row.snapshotDate)}</td>
      <td className="px-2 py-2 text-xs">{row.source ?? "—"}</td>
      <td className="px-2 py-2">
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          className={`${pfControl} min-w-[5rem]`}
          value={row.weight ?? ""}
          onChange={(e) =>
            onChange(row.competitorAsin, {
              weight: parseOptionalDecimal(e.target.value),
            })
          }
          placeholder="0–1"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min={0}
          max={1}
          step={0.01}
          className={`${pfControl} min-w-[5rem]`}
          value={row.capturePct ?? ""}
          onChange={(e) =>
            onChange(row.competitorAsin, {
              capturePct: parseOptionalDecimal(e.target.value),
            })
          }
          placeholder="0–1"
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="text"
          className={`${pfControl} min-w-[8rem]`}
          value={row.notes ?? ""}
          onChange={(e) =>
            onChange(row.competitorAsin, {
              notes: e.target.value.trim() === "" ? null : e.target.value,
            })
          }
          placeholder="Notas"
        />
      </td>
    </tr>
  );
}

function CompetitorMobileCard({ row, onChange }: RowProps) {
  return (
    <ResponsiveDataCard
      title={row.competitorAsin}
      subtitle={row.competitorTitle ?? undefined}
      fields={[
        {
          label: "Seleccionado",
          value: (
            <input
              type="checkbox"
              checked={row.isSelected}
              onChange={(e) =>
                onChange(row.competitorAsin, { isSelected: e.target.checked })
              }
            />
          ),
        },
        {
          label: "Usar en forecast",
          value: (
            <input
              type="checkbox"
              checked={row.useForForecast}
              onChange={(e) =>
                onChange(row.competitorAsin, {
                  useForForecast: e.target.checked,
                })
              }
            />
          ),
        },
        { label: "Precio", value: fmtMoney(row.price) },
        { label: "Rating", value: fmtNumber(row.rating, 1) },
        { label: "Reviews", value: fmtNumber(row.reviewCount, 0) },
        { label: "BSR", value: fmtNumber(row.bsr, 0) },
        {
          label: "Uds/mes",
          value: fmtNumber(row.estimatedMonthlyUnits, 0),
        },
        {
          label: "Ingresos/mes",
          value: fmtMoney(row.estimatedMonthlyRevenue),
        },
        { label: "Snapshot", value: fmtDate(row.snapshotDate) },
        { label: "Fuente", value: row.source ?? "—" },
        {
          label: "Peso",
          value: (
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              className={pfFieldClass()}
              value={row.weight ?? ""}
              onChange={(e) =>
                onChange(row.competitorAsin, {
                  weight: parseOptionalDecimal(e.target.value),
                })
              }
            />
          ),
        },
        {
          label: "Captura",
          value: (
            <input
              type="number"
              min={0}
              max={1}
              step={0.01}
              className={pfFieldClass()}
              value={row.capturePct ?? ""}
              onChange={(e) =>
                onChange(row.competitorAsin, {
                  capturePct: parseOptionalDecimal(e.target.value),
                })
              }
            />
          ),
        },
        {
          label: "Notas",
          value: (
            <input
              type="text"
              className={pfFieldClass()}
              value={row.notes ?? ""}
              onChange={(e) =>
                onChange(row.competitorAsin, {
                  notes: e.target.value.trim() === "" ? null : e.target.value,
                })
              }
            />
          ),
        },
      ]}
    />
  );
}
