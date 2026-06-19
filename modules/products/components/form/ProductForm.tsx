"use client";

import type { useProductForm } from "../../hooks/useProductForm";
import type { ProductFormTab } from "../../types/product-form.types";
import { ProductFormShell } from "./ProductFormShell";
import { GeneralForm } from "./forms/GeneralForm";
import { DetailForm } from "./forms/DetailForm";
import { CostsForm } from "./forms/CostsForm";
import { ProductDocumentsForm } from "./forms/ProductDocumentsForm";
import { ProductFormVariantsPanel } from "./forms/ProductFormVariantsPanel";
import { ProductAmazonMarketplaceSection } from "./ProductAmazonMarketplaceSection";
import { ProductBenchmarkingPanel } from "../ProductBenchmarkingPanel";

type ProductFormProps = {
  form: ReturnType<typeof useProductForm>;
  formId?: string;
  activeTab: ProductFormTab;
  onTabChange: (tab: ProductFormTab) => void;
};

export function ProductForm({
  form,
  formId = "product-main-form",
  activeTab,
  onTabChange,
}: ProductFormProps) {
  const busy = form.saving || form.uploadingImage;

  const primaryLabel = form.saving
    ? "Guardando…"
    : form.uploadingImage
      ? "Subiendo imagen…"
      : form.isEditMode
        ? "Guardar cambios"
        : form.isVariant
          ? "Crear variante"
          : "Crear producto";

  return (
    <form
      id={formId}
      onSubmit={(e) => {
        e.preventDefault();
        form.submit();
      }}
      className="space-y-6"
    >
      <ProductFormShell
        activeTab={activeTab}
        onTabChange={onTabChange}
        isVariant={form.isVariant}
        documentsEnabled={Boolean(form.productId)}
        benchmarkingEnabled={Boolean(form.productId)}
      />

      {activeTab === "general" ? <GeneralForm form={form} /> : null}
      {activeTab === "detalle" ? <DetailForm form={form} /> : null}
      {activeTab === "costes" ? <CostsForm form={form} /> : null}
      {activeTab === "documentacion" ? (
        form.productId ? (
          <ProductDocumentsForm form={form} />
        ) : (
          <section className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            Guarda primero el producto para poder subir documentación.
          </section>
        )
      ) : null}
      {activeTab === "variantes" ? (
        <ProductFormVariantsPanel form={form} />
      ) : null}
      {activeTab === "amazon" ? (
        <ProductAmazonMarketplaceSection form={form} />
      ) : null}
      {activeTab === "benchmarking" ? (
        form.productId ? (
          <ProductBenchmarkingPanel productId={form.productId} />
        ) : (
          <section className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            Guarda primero el producto para poder configurar benchmarking y
            competidores.
          </section>
        )
      ) : null}

      <div className="sticky bottom-0 z-10 -mx-4 mt-8 border-t border-slate-200 bg-slate-50/95 px-4 py-4 backdrop-blur-sm supports-[backdrop-filter]:bg-slate-50/80 sm:static sm:mx-0 sm:rounded-xl sm:border sm:border-slate-200 sm:bg-white sm:px-6 sm:py-5 sm:shadow-sm">
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"
            onClick={form.cancel}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-60"
            disabled={busy}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
