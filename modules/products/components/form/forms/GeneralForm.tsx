"use client";

import type { useProductForm } from "../../../hooks/useProductForm";
import { ProductFormGeneralSection } from "../sections/ProductFormGeneralSection";
import { ProductFormCategorySection } from "../sections/ProductFormCategorySection";
import { ProductFormDetailSection } from "../sections/ProductFormDetailSection";
import { ProductFormIdentifiersSection } from "../sections/ProductFormIdentifiersSection";
import {
  pfCard,
  pfCardBody,
  pfCardHeader,
  pfCardTitle,
  pfFieldClass,
  pfGrid,
  pfLabel,
  pfSpan2,
  pfTextarea,
} from "../productFormUi";

type Props = {
  form: ReturnType<typeof useProductForm>;
};

function fmtDays(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n} días`;
}

/** Datos generales: identidad, proveedor, categoría, imagen y notas. */
export function GeneralForm({ form }: Props) {
  const { values, updateField, isVariant, parentSummary, selectedSupplierLogistics } =
    form;

  return (
    <div className="space-y-6">
      {isVariant && parentSummary ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Creando variante de{" "}
          <span className="font-semibold">{parentSummary.sku}</span> —{" "}
          {parentSummary.nombre}
        </div>
      ) : null}

      <ProductFormGeneralSection form={form} />

      {selectedSupplierLogistics ? (
        <section className="rounded-xl border border-slate-200 bg-slate-50/80 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Logística del proveedor
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Estos tiempos vienen del proveedor y se usarán en pedidos,
            planificación y forecast.
          </p>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Días producción estándar
              </dt>
              <dd className="font-medium text-slate-800">
                {fmtDays(selectedSupplierLogistics.diasProduccionEstandar)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Días tránsito estándar
              </dt>
              <dd className="font-medium text-slate-800">
                {fmtDays(selectedSupplierLogistics.diasTransitoEstandar)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Puerto preferido
              </dt>
              <dd className="font-medium text-slate-800">
                {selectedSupplierLogistics.puertoPreferidoNombre ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Agente de compras
              </dt>
              <dd className="font-medium text-slate-800">
                {selectedSupplierLogistics.agenteContacto ?? "—"}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className={pfCard}>
        <div className={pfCardHeader}>
          <h2 className={pfCardTitle}>Identificadores</h2>
        </div>
        <div className={pfCardBody}>
          <ProductFormIdentifiersSection form={form} embedded />
        </div>
      </section>

      <ProductFormCategorySection form={form} mode="select" />

      <ProductFormDetailSection form={form} imageOnly />

      <section className={pfCard}>
        <div className={pfCardHeader}>
          <h2 className={pfCardTitle}>Otros datos generales</h2>
        </div>
        <div className={pfCardBody}>
          <div className={pfGrid}>
            <div>
              <label className={pfLabel} htmlFor="pf-stock-min">
                Stock seguridad mínimo
              </label>
              <input
                id="pf-stock-min"
                type="number"
                className={pfFieldClass(false)}
                value={values.stockSeguridadMinimo}
                onChange={(e) =>
                  updateField("stockSeguridadMinimo", Number(e.target.value) || 0)
                }
              />
            </div>
            <div className={pfSpan2}>
              <label className={pfLabel} htmlFor="pf-notas">
                Notas generales
              </label>
              <textarea
                id="pf-notas"
                className={pfTextarea}
                rows={3}
                value={values.notasGenerales}
                onChange={(e) => updateField("notasGenerales", e.target.value)}
                placeholder="Observaciones internas…"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
