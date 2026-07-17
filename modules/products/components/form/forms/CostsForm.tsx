"use client";

import type { useProductForm } from "../../../hooks/useProductForm";
import {
  PRODUCT_COST_CURRENCIES,
} from "../../../constants/productCostCurrencies";
import {
  pfCard,
  pfCardBody,
  pfCardHeader,
  pfCardTitle,
  pfFieldClass,
  pfGrid,
  pfInvalidFeedback,
  pfLabel,
  pfSpan2,
} from "../productFormUi";

function fmtEur(n: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function toNum(s: string): number {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}


type Props = {
  form: ReturnType<typeof useProductForm>;
};

function formatBaseCostLabel(
  monto: number | null | undefined,
  moneda: string | null | undefined,
): string {
  const n = Number(monto);
  if (!Number.isFinite(n) || n <= 0) return "pendiente";
  const m = moneda ? String(moneda).toUpperCase() : "—";
  return `${n.toFixed(4).replace(/\.?0+$/, "")} ${m}`;
}

/** Coste base de fábrica en moneda original; coste EUR real viene de orden/lote. */
export function CostsForm({ form }: Props) {
  const { values, errors, updateField, isVariant, isEditMode, variantCount } = form;
  const inheritsCost = values.heredarCosteUnitarioTotal && isVariant;
  const canPropagateCostToVariants =
    isEditMode && !isVariant && variantCount > 0;

  const costeRealEur =
    values.costoUnitarioTotalEur > 0 ? values.costoUnitarioTotalEur : null;

  const effectiveMonto =
    values.costeBaseEfectivoMonto ??
    (values.costoFabricaMonto > 0 ? values.costoFabricaMonto : null);
  const effectiveMoneda =
    values.costeBaseEfectivoMoneda ??
    (values.costoFabricaMonto > 0 ? values.costoFabricaMoneda : null);
  const effectiveSource =
    values.costeBaseSource !== "none"
      ? values.costeBaseSource
      : values.costoFabricaMonto > 0
        ? "own"
        : "none";

  const precio = values.heredarPrecio && isVariant ? 0 : values.precioVentaBase;
  const margenPct =
    precio > 0 && costeRealEur != null && costeRealEur > 0
      ? ((precio - costeRealEur) / precio) * 100
      : null;

  return (
    <div className="space-y-6">
      {isVariant ? (
        <section className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <label className="flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
              checked={values.heredarPrecio}
              onChange={(e) => updateField("heredarPrecio", e.target.checked)}
            />
            <span className="text-sm font-medium text-blue-900">
              Heredar precio de venta del producto padre
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
              checked={values.heredarCosteUnitarioTotal}
              onChange={(e) =>
                updateField("heredarCosteUnitarioTotal", e.target.checked)
              }
            />
            <span>
              <span className="block text-sm font-medium text-blue-900">
                Heredar coste unitario total del padre
              </span>
              <span className="block text-xs text-blue-800">
                Usa el coste unitario total del producto padre para esta variante.
              </span>
            </span>
          </label>
        </section>
      ) : null}

      <section className={pfCard}>
        <div className={pfCardHeader}>
          <h2 className={pfCardTitle}>Coste de fábrica</h2>
          <p className="mt-1 text-xs text-slate-500">
            Coste base en moneda original. El EUR real se fija en la orden/lote.
          </p>
        </div>
        <div className={pfCardBody}>
          {canPropagateCostToVariants ? (
            <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-600"
                checked={values.applyCostChangeToVariants}
                onChange={(e) =>
                  updateField("applyCostChangeToVariants", e.target.checked)
                }
              />
              <span>
                <span className="block text-sm font-medium text-amber-950">
                  Aplicar este cambio de coste a las variantes
                </span>
                <span className="block text-xs text-amber-800">
                  Copia solo coste de fabrica y moneda a variantes activas.
                </span>
              </span>
            </label>
          ) : null}
          <div className={pfGrid}>
            <div>
              <label className={pfLabel} htmlFor="pf-costo-monto">
                Importe compra
              </label>
              <input
                id="pf-costo-monto"
                type="number"
                step="0.0001"
                className={pfFieldClass(false)}
                value={inheritsCost ? "" : values.costoFabricaMonto || ""}
                disabled={inheritsCost}
                placeholder={inheritsCost ? "Heredado del padre" : ""}
                onChange={(e) =>
                  updateField("costoFabricaMonto", toNum(e.target.value))
                }
              />
            </div>
            <div>
              <label className={pfLabel} htmlFor="pf-costo-moneda">
                Moneda
              </label>
              <select
                id="pf-costo-moneda"
                className={pfFieldClass(false)}
                value={values.costoFabricaMoneda}
                disabled={inheritsCost}
                onChange={(e) => {
                  const moneda = e.target.value as typeof values.costoFabricaMoneda;
                  updateField("costoFabricaMoneda", moneda);
                }}
              >
                {PRODUCT_COST_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={pfLabel} htmlFor="pf-arancel">
                Arancel (%)
              </label>
              <input
                id="pf-arancel"
                type="number"
                step="0.01"
                className={pfFieldClass(false)}
                value={inheritsCost ? "" : values.arancelPorcentaje}
                disabled={inheritsCost}
                placeholder={inheritsCost ? "Heredado del padre" : ""}
                onChange={(e) =>
                  updateField("arancelPorcentaje", toNum(e.target.value))
                }
              />
            </div>
            <div className={pfSpan2}>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm space-y-2">
                <p>
                  Coste fábrica base:{" "}
                  <strong>{formatBaseCostLabel(effectiveMonto, effectiveMoneda)}</strong>
                  {inheritsCost || effectiveSource === "parent" ? (
                    <span className="ml-2 text-xs font-normal text-blue-700">
                      Heredado del padre
                    </span>
                  ) : null}
                </p>
                <p>
                  Coste real EUR:{" "}
                  <strong>
                    {costeRealEur != null
                      ? fmtEur(costeRealEur)
                      : "Pendiente de orden/lote"}
                  </strong>
                  {inheritsCost ? (
                    <span className="ml-2 text-xs font-normal text-blue-700">
                      Heredado del padre
                    </span>
                  ) : null}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={pfCard}>
        <div className={pfCardHeader}>
          <h2 className={pfCardTitle}>Costes logísticos (solo lectura)</h2>
          <p className="mt-1 text-xs text-slate-500">
            Rellenados al facturar contenedores; no editables aquí.
          </p>
        </div>
        <div className={pfCardBody}>
          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <p className="text-xs text-slate-500">Tránsito / u</p>
              <p className="font-medium">
                {values.transitoEurUnit > 0
                  ? fmtEur(values.transitoEurUnit)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Llegada puerto / u</p>
              <p className="font-medium">
                {values.gastosLlegadaPuertoEurUnit > 0
                  ? fmtEur(values.gastosLlegadaPuertoEurUnit)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Flete / u</p>
              <p className="font-medium">
                {values.costoFleteUnitEur > 0
                  ? fmtEur(values.costoFleteUnitEur)
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Total unitario EUR</p>
              <p className="font-medium">
                {values.costoUnitarioTotalEur > 0
                  ? fmtEur(values.costoUnitarioTotalEur)
                  : "—"}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className={pfCard}>
        <div className={pfCardHeader}>
          <h2 className={pfCardTitle}>Precio venta y margen</h2>
        </div>
        <div className={pfCardBody}>
          <div className={pfGrid}>
            <div>
              <label className={pfLabel} htmlFor="pf-precio">
                Precio venta objetivo (EUR)
              </label>
              <input
                id="pf-precio"
                type="number"
                step="0.01"
                className={pfFieldClass(Boolean(errors.precioVentaBase))}
                value={values.heredarPrecio && isVariant ? "" : values.precioVentaBase}
                disabled={values.heredarPrecio && isVariant}
                placeholder={
                  values.heredarPrecio && isVariant ? "Heredado del padre" : ""
                }
                onChange={(e) =>
                  updateField("precioVentaBase", toNum(e.target.value))
                }
              />
              {errors.precioVentaBase ? (
                <div className={pfInvalidFeedback}>{errors.precioVentaBase}</div>
              ) : null}
            </div>
            <div>
              <label className={pfLabel} htmlFor="pf-canal">
                Canal
              </label>
              <select
                id="pf-canal"
                className={pfFieldClass(false)}
                value={values.priceChannel}
                onChange={(e) => updateField("priceChannel", e.target.value)}
              >
                <option value="AMAZON_FBA">AMAZON_FBA</option>
                <option value="AMAZON_FBM">AMAZON_FBM</option>
                <option value="DIRECT">DIRECTO</option>
              </select>
            </div>
            <div className={pfSpan2}>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                <p>
                  Margen bruto (requiere coste real de lote):{" "}
                  <strong
                    className={
                      margenPct == null
                        ? "text-slate-500"
                        : margenPct < 20
                          ? "text-red-600"
                          : margenPct < 40
                            ? "text-amber-600"
                            : "text-emerald-600"
                    }
                  >
                    {margenPct != null ? `${margenPct.toFixed(1)} %` : "—"}
                  </strong>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
