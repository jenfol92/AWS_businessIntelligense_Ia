"use client";

import { useMemo } from "react";
import type { useProductForm } from "../../../hooks/useProductForm";
import { InheritanceOverrideControl } from "../InheritanceOverrideControl";
import { calculateCubicajeUnitarioM3 } from "../../../utils/calculateCubicajeUnitarioM3";
import {
  pfCard,
  pfCardBody,
  pfCardHeader,
  pfCardTitle,
  pfFieldClass,
  pfGrid,
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

/** Unidades por caja, pedido mínimo y vista previa de CBM desde medidas de caja. */
export function ProductFormLogisticsSection({ form }: Props) {
  const { values, updateField } = form;

  const cbmPreview = useMemo(
    () =>
      calculateCubicajeUnitarioM3(
        values.largoCajaCm,
        values.anchoCajaCm,
        values.altoCajaCm,
      ),
    [values.largoCajaCm, values.anchoCajaCm, values.altoCajaCm],
  );

  const cbmDisplay =
    cbmPreview ?? (values.cubicajeUnitarioM3 > 0 ? values.cubicajeUnitarioM3 : null);

  return (
    <section className={pfCard} aria-labelledby="product-section-logistics">
      <div className={pfCardHeader}>
        <h2 id="product-section-logistics" className={pfCardTitle}>
          Logística comercial
        </h2>
      </div>
      <div className={pfCardBody}>
        <div className={pfGrid}>
          <div>
            <label className={pfLabel} htmlFor="pf-uxcaja">
              Unidades por caja
            </label>
            <input
              id="pf-uxcaja"
              type="number"
              className={pfFieldClass(false)}
              value={values.unidadesPorCaja || ""}
              onChange={(e) =>
                updateField("unidadesPorCaja", toNum(e.target.value))
              }
            />
            <InheritanceOverrideControl form={form} field="unidadesPorCaja" />
          </div>
          <div>
            <label className={pfLabel} htmlFor="pf-pedido-min">
              Pedido mínimo (uds.)
            </label>
            <input
              id="pf-pedido-min"
              type="number"
              className={pfFieldClass(false)}
              value={values.pedidoMinimoUnidades || ""}
              onChange={(e) =>
                updateField("pedidoMinimoUnidades", toNum(e.target.value))
              }
            />
            <InheritanceOverrideControl form={form} field="pedidoMinimoUnidades" />
          </div>
          <div className={pfSpan2}>
            <label className={pfLabel}>Cubicaje unitario</label>
            {cbmDisplay != null ? (
              <>
                <p className="mt-2 text-lg font-semibold text-slate-800">
                  {cbmDisplay.toFixed(6)} m³
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {cbmPreview != null
                    ? "Vista previa desde medidas de caja (largo × ancho × alto). El valor definitivo se calcula al guardar."
                    : "Valor guardado en producto_logistica."}
                </p>
              </>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                Indica largo, ancho y alto de caja (cm) en la sección Materiales,
                pesos y medidas para calcular el CBM.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
