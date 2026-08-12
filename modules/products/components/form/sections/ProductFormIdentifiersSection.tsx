"use client";

import type { useProductForm } from "../../../hooks/useProductForm";
import { InheritanceOverrideControl } from "../InheritanceOverrideControl";
import {
  pfCard,
  pfCardBody,
  pfCardHeader,
  pfCardTitle,
  pfFieldClass,
  pfGrid,
  pfLabel,
} from "../productFormUi";

type Props = {
  form: ReturnType<typeof useProductForm>;
  /** Sin card exterior (dentro de GeneralForm). */
  embedded?: boolean;
};

export function ProductFormIdentifiersSection({ form, embedded = false }: Props) {
  const { values, updateField } = form;

  const fields = (
    <div className={pfGrid}>
          <div>
            <label className={pfLabel} htmlFor="pf-ean">
              EAN
            </label>
            <input
              id="pf-ean"
              className={pfFieldClass(false)}
              value={values.ean}
              onChange={(e) => updateField("ean", e.target.value)}
            />
          </div>
          <div>
            <label className={pfLabel} htmlFor="pf-ref-fab">
              Referencia fabricante
            </label>
            <input
              id="pf-ref-fab"
              className={pfFieldClass(false)}
              value={values.referenciaFabricante}
              onChange={(e) =>
                updateField("referenciaFabricante", e.target.value)
              }
            />
            <InheritanceOverrideControl form={form} field="referenciaFabricante" />
          </div>
          <div className="sm:col-span-2">
            <label className={pfLabel} htmlFor="pf-cod-prov">
              Código proveedor
            </label>
            <input
              id="pf-cod-prov"
              className={pfFieldClass(false)}
              value={values.codigoProveedor}
              onChange={(e) =>
                updateField("codigoProveedor", e.target.value)
              }
            />
          </div>
    </div>
  );

  if (embedded) return fields;

  return (
    <section className={pfCard} aria-labelledby="product-section-identifiers">
      <div className={pfCardHeader}>
        <h2 id="product-section-identifiers" className={pfCardTitle}>
          Identificadores
        </h2>
      </div>
      <div className={pfCardBody}>{fields}</div>
    </section>
  );
}
