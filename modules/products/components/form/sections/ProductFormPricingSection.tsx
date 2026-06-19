"use client";

import type { useProductForm } from "../../../hooks/useProductForm";
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

type Props = {
  form: ReturnType<typeof useProductForm>;
};

function toNum(s: string): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function ProductFormPricingSection({ form }: Props) {
  const { values, errors, updateField } = form;

  return (
    <section className={pfCard} aria-labelledby="product-section-pricing">
      <div className={pfCardHeader}>
        <h2 id="product-section-pricing" className={pfCardTitle}>
          Precio y configuración comercial
        </h2>
      </div>
      <div className={pfCardBody}>
        <div className={pfGrid}>
          <div>
            <label className={pfLabel} htmlFor="pf-precio">
              Precio venta base (objetivo)
            </label>
            <input
              id="pf-precio"
              type="number"
              step="0.01"
              className={pfFieldClass(Boolean(errors.precioVentaBase))}
              value={values.precioVentaBase}
              onChange={(e) =>
                updateField("precioVentaBase", toNum(e.target.value))
              }
            />
            {errors.precioVentaBase ? (
              <div className={pfInvalidFeedback}>
                {errors.precioVentaBase}
              </div>
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
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-3">
              <input
                id="heredarPrecio"
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-2 focus:ring-blue-500/30"
                checked={values.heredarPrecio}
                onChange={(e) =>
                  updateField("heredarPrecio", e.target.checked)
                }
              />
              <label
                className="text-sm font-medium text-slate-700"
                htmlFor="heredarPrecio"
              >
                Heredar precio (variante)
              </label>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
