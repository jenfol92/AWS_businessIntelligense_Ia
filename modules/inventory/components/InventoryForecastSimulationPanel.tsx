"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Text } from "@tremor/react";
import type { ForecastMethod } from "@/modules/planning/types";
import type { ProductForecastConfigUpsertBody } from "@/modules/planning/types";
import {
  fetchProductForecastConfig,
  saveProductForecastConfig,
  type ProductForecastConfigFormState,
} from "@/modules/products/services/productBenchmarkClient";
import { buildForecastMethodInfoFromConfig } from "../services/buildForecastMethodInfo";
import { formatMethodOptionLabel } from "../services/forecastMethodDescriptions";
import {
  SELECTABLE_FORECAST_METHODS,
  forecastMethodBusinessLabel,
  resolveDisplayForecastMethod,
  usesCompetitorCapture,
} from "../services/forecastMethodUi";
import { ForecastMethodExplanationBox } from "./ForecastMethodExplanationBox";

function parseOptionalDecimal(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function toUpsertBody(
  state: ProductForecastConfigFormState,
): ProductForecastConfigUpsertBody {
  return {
    forecastMethod: state.forecastMethod,
    forecastMixOwnWeight: state.forecastMixOwnWeight,
    forecastMixCompetitorWeight: state.forecastMixCompetitorWeight,
    competitorCapturePct: state.competitorCapturePct,
    stockoutCorrectionEnabled: state.stockoutCorrectionEnabled,
  };
}

function assertRange(value: number | null, label: string): string | null {
  if (value == null) return null;
  if (value < 0 || value > 1) return `${label} debe estar entre 0 y 1.`;
  return null;
}

function validateState(state: ProductForecastConfigFormState): string | null {
  return (
    assertRange(state.forecastMixOwnWeight, "Peso ventas propias") ??
    assertRange(state.forecastMixCompetitorWeight, "Peso competidores") ??
    assertRange(state.competitorCapturePct, "Captura competidor")
  );
}

type Props = {
  productId: string;
  isSimulationActive: boolean;
  onSimulate: (override: ProductForecastConfigUpsertBody) => Promise<void>;
  onSaved: (saved: ProductForecastConfigFormState) => Promise<void>;
  /** Disponibilidad de datos del producto cargado (desde detalle inventario). */
  dataAvailability?: {
    hasOwnSales: boolean;
    hasBenchmark: boolean;
  };
  stockoutRiskHint?: boolean;
};

export function InventoryForecastSimulationPanel({
  productId,
  isSimulationActive,
  onSimulate,
  onSaved,
  dataAvailability,
  stockoutRiskHint = false,
}: Props) {
  const [draft, setDraft] = useState<ProductForecastConfigFormState | null>(null);
  const [saved, setSaved] = useState<ProductForecastConfigFormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageError, setMessageError] = useState(false);

  const loadSavedConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const config = await fetchProductForecastConfig(productId);
      setDraft(config);
      setSaved(config);
    } catch (e) {
      setDraft(null);
      setSaved(null);
      setLoadError(
        e instanceof Error ? e.message : "No se pudo cargar la configuración.",
      );
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void loadSavedConfig();
  }, [loadSavedConfig]);

  async function handleSimulate() {
    if (!draft) return;
    const err = validateState(draft);
    if (err) {
      setMessage(err);
      setMessageError(true);
      return;
    }
    setSimulating(true);
    setMessage(null);
    setMessageError(false);
    try {
      await onSimulate(toUpsertBody(draft));
      setMessage("Simulación aplicada. Los valores no se han guardado en BD.");
      setMessageError(false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al simular.");
      setMessageError(true);
    } finally {
      setSimulating(false);
    }
  }

  async function handleSave() {
    if (!draft) return;
    const err = validateState(draft);
    if (err) {
      setMessage(err);
      setMessageError(true);
      return;
    }
    setSaving(true);
    setMessage(null);
    setMessageError(false);
    try {
      const persisted = await saveProductForecastConfig(
        productId,
        toUpsertBody(draft),
      );
      setDraft(persisted);
      setSaved(persisted);
      await onSaved(persisted);
      setMessage("Configuración guardada como predeterminada del producto.");
      setMessageError(false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Error al guardar.");
      setMessageError(true);
    } finally {
      setSaving(false);
    }
  }

  const showMixedFields = draft?.forecastMethod === "MIXED";
  const showCaptureField = usesCompetitorCapture(draft?.forecastMethod);
  const busy = simulating || saving;

  const draftMethodInfo =
    draft != null
      ? buildForecastMethodInfoFromConfig(toUpsertBody(draft), {
          hasOwnSales: dataAvailability?.hasOwnSales ?? false,
          hasBenchmark: dataAvailability?.hasBenchmark ?? false,
          stockoutRiskHint,
          horizonLabel: "anual",
        })
      : null;

  return (
    <div className="space-y-4">
      <Text className="text-xs text-slate-500">
        La simulación no modifica la configuración del producto hasta que pulses
        Guardar como configuración del producto.
      </Text>

      {isSimulationActive ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          Vista de simulación activa — los bloques de forecast muestran el método
          seleccionado abajo, no necesariamente la config guardada en BD.
        </div>
      ) : null}

      {loading && !draft ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando configuración…
        </div>
      ) : null}

      {loadError && !draft ? (
        <div className="space-y-2">
          <p className="text-sm text-red-700">{loadError}</p>
          <button
            type="button"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
            onClick={() => void loadSavedConfig()}
          >
            Reintentar
          </button>
        </div>
      ) : null}

      {draft ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block sm:col-span-2 lg:col-span-3">
              <Text className="mb-1 text-xs text-slate-500">Método</Text>
              <select
                value={
                  draft.forecastMethod === "AUTO"
                    ? resolveDisplayForecastMethod(
                        draft.forecastMethod,
                        draftMethodInfo?.effectiveMethod,
                      )
                    : draft.forecastMethod
                }
                onChange={(e) =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          forecastMethod: e.target.value as ForecastMethod,
                        }
                      : prev,
                  )
                }
                disabled={busy}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                {SELECTABLE_FORECAST_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {formatMethodOptionLabel(method)}
                  </option>
                ))}
              </select>
            </label>

            {draftMethodInfo ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <ForecastMethodExplanationBox info={draftMethodInfo} />
              </div>
            ) : null}

            {showMixedFields ? (
              <>
                <label className="block">
                  <Text className="mb-1 text-xs text-slate-500">
                    Peso ventas propias (0–1)
                  </Text>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={draft.forecastMixOwnWeight ?? ""}
                    onChange={(e) =>
                      setDraft((prev) =>
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
                    disabled={busy}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    placeholder="0.4"
                  />
                </label>
                <label className="block">
                  <Text className="mb-1 text-xs text-slate-500">
                    Peso competidores (0–1)
                  </Text>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={draft.forecastMixCompetitorWeight ?? ""}
                    onChange={(e) =>
                      setDraft((prev) =>
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
                    disabled={busy}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    placeholder="0.6"
                  />
                </label>
              </>
            ) : null}

            {showCaptureField ? (
              <label className="block">
                <Text className="mb-1 text-xs text-slate-500">
                  Captura competidor (%)
                </Text>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={
                    draft.competitorCapturePct != null
                      ? Math.round(draft.competitorCapturePct * 1000) / 10
                      : ""
                  }
                  onChange={(e) =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            competitorCapturePct: parseOptionalDecimal(
                              e.target.value,
                            )
                              ? (parseOptionalDecimal(e.target.value) ?? 0) / 100
                              : null,
                          }
                        : prev,
                    )
                  }
                  disabled={busy}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  placeholder="7"
                />
              </label>
            ) : null}
          </div>

          {draft.forecastMethod === "OWN_SALES_CORRECTED" ? (
            <p className="text-xs text-slate-600">
              Usa histórico de stock FBA para estimar ventas perdidas por rotura.
            </p>
          ) : null}
          {draft.forecastMethod === "MANUAL" ? (
            <p className="text-xs text-slate-500">
              Forecast manual en preparación.
            </p>
          ) : null}
          {!dataAvailability ? (
            <p className="text-xs text-slate-500">
              Simula para ver cómo afectan los datos reales del producto a este
              método.
            </p>
          ) : null}

          {saved ? (
            <Text className="text-xs text-slate-500">
              Configuración guardada:{" "}
              <span className="font-medium text-slate-700">
                {forecastMethodBusinessLabel(
                  resolveDisplayForecastMethod(
                    saved.forecastMethod,
                    draftMethodInfo?.effectiveMethod,
                  ),
                )}
              </span>
            </Text>
          ) : null}

          {message ? (
            <p
              className={
                messageError ? "text-sm text-red-700" : "text-sm text-green-700"
              }
            >
              {message}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleSimulate()}
              disabled={busy || loading}
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-60"
            >
              {simulating ? "Simulando…" : "Simular"}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy || loading}
              className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? "Guardando…" : "Guardar como configuración del producto"}
            </button>
            {saved && draft.forecastMethod !== saved.forecastMethod ? (
              <button
                type="button"
                onClick={() => setDraft(saved)}
                disabled={busy}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Restaurar guardado
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
