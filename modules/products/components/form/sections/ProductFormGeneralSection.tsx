"use client";

import { useEffect } from "react";

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

export function ProductFormGeneralSection({ form }: Props) {
  const { values, errors, updateField, suppliers, loadingSuppliers } = form;

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    console.debug("[ProductFormGeneral] suppliers in component:", suppliers.length);
  }, [suppliers]);

  return (
    <section className={pfCard} aria-labelledby="product-section-general">
      <div className={pfCardHeader}>
        <h2 id="product-section-general" className={pfCardTitle}>
          Información general
        </h2>
      </div>
      <div className={pfCardBody}>
        <div className={pfGrid}>
          <div>
            <label className={pfLabel} htmlFor="pf-sku">
              SKU
            </label>
            <input
              id="pf-sku"
              className={pfFieldClass(Boolean(errors.sku))}
              value={values.sku}
              onChange={(e) => updateField("sku", e.target.value)}
              autoComplete="off"
            />
            {errors.sku ? (
              <div className={pfInvalidFeedback}>{errors.sku}</div>
            ) : null}
          </div>
          <div>
            <label className={pfLabel} htmlFor="pf-asin">
              ASIN
            </label>
            <input
              id="pf-asin"
              className={pfFieldClass(false)}
              value={values.asin}
              onChange={(e) => updateField("asin", e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className={pfSpan2}>
            <label className={pfLabel} htmlFor="pf-nombre">
              Nombre del producto
            </label>
            <input
              id="pf-nombre"
              className={pfFieldClass(Boolean(errors.nombre))}
              value={values.nombre}
              onChange={(e) => updateField("nombre", e.target.value)}
            />
            {errors.nombre ? (
              <div className={pfInvalidFeedback}>{errors.nombre}</div>
            ) : null}
          </div>
          <div>
            <label className={pfLabel} htmlFor="pf-estado">
              Estado
            </label>
            <select
              id="pf-estado"
              className={pfFieldClass(false)}
              value={values.estado}
              onChange={(e) => updateField("estado", e.target.value)}
            >
              <option value="activo">activo</option>
              <option value="borrador">borrador</option>
              <option value="descatalogado">descatalogado</option>
            </select>
          </div>
          <div>
            <label className={pfLabel} htmlFor="pf-proveedor">
              Proveedor
            </label>
            <select
              id="pf-proveedor"
              className={pfFieldClass(false)}
              value={values.proveedorId}
              onChange={(e) => updateField("proveedorId", e.target.value)}
              disabled={loadingSuppliers}
            >
              <option value="">Seleccionar proveedor…</option>
              {suppliers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.pais ? ` (${p.pais})` : ""}
                </option>
              ))}
            </select>
            {loadingSuppliers ? (
              <p className="mt-1 text-xs text-slate-500">
                Cargando proveedores…
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
