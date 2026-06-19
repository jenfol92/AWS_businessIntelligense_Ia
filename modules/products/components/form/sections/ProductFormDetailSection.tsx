"use client";

import { Image as ImageIcon, Upload } from "lucide-react";
import type { useProductForm } from "../../../hooks/useProductForm";
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
  /** Solo bloque de imagen (pestaña General). */
  imageOnly?: boolean;
};

export function ProductFormDetailSection({ form, imageOnly = false }: Props) {
  const {
    values,
    updateField,
    handleImageUpload,
    uploadingImage,
  } = form;

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handleImageUpload(file);
  }

  const imageBlock = (
    <div className={pfSpan2}>
      <span className={pfLabel}>Imagen principal</span>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex shrink-0 items-start gap-4">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            {values.imagenUrl ? (
              <img
                src={values.imagenUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <ImageIcon
                  className="h-8 w-8 text-slate-400"
                  strokeWidth={1.5}
                  aria-hidden
                />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-400 hover:bg-blue-50/50">
              {uploadingImage ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                  <span className="text-blue-700">Subiendo…</span>
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 text-slate-500" aria-hidden />
                  <span>
                    {values.imagenUrl ? "Cambiar imagen" : "Subir imagen"}
                  </span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={onFileChange}
                disabled={uploadingImage}
              />
            </label>
            <p className="text-xs text-slate-500">JPG, PNG, GIF · máx. 5 MB</p>
          </div>
        </div>
      </div>
    </div>
  );

  if (imageOnly) {
    return (
      <section className={pfCard} aria-labelledby="product-section-image">
        <div className={pfCardHeader}>
          <h2 id="product-section-image" className={pfCardTitle}>
            Imagen principal
          </h2>
        </div>
        <div className={pfCardBody}>
          <div className={pfGrid}>{imageBlock}</div>
        </div>
      </section>
    );
  }

  return (
    <section className={pfCard} aria-labelledby="product-section-detail">
      <div className={pfCardHeader}>
        <h2 id="product-section-detail" className={pfCardTitle}>
          Detalle del producto
        </h2>
      </div>
      <div className={pfCardBody}>
        <div className={pfGrid}>
          {imageBlock}
          <div>
            <label className={pfLabel} htmlFor="pf-marca">
              Marca
            </label>
            <input
              id="pf-marca"
              className={pfFieldClass(false)}
              value={values.marca}
              onChange={(e) => updateField("marca", e.target.value)}
            />
          </div>
          <div>
            <label className={pfLabel} htmlFor="pf-modelo">
              Modelo
            </label>
            <input
              id="pf-modelo"
              className={pfFieldClass(false)}
              value={values.modelo}
              onChange={(e) => updateField("modelo", e.target.value)}
            />
          </div>
          <div>
            <label className={pfLabel} htmlFor="pf-color">
              Color
            </label>
            <input
              id="pf-color"
              className={pfFieldClass(false)}
              value={values.color}
              onChange={(e) => updateField("color", e.target.value)}
            />
          </div>
          <div className={pfSpan2}>
            <label className={pfLabel} htmlFor="pf-desc-tecnica">
              Descripción técnica (ERP)
            </label>
            <textarea
              id="pf-desc-tecnica"
              className={pfTextarea}
              rows={4}
              value={values.descripcionTecnica}
              onChange={(e) =>
                updateField("descripcionTecnica", e.target.value)
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}
