"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ProductForm } from "./ProductForm";
import { ProductFormCreatedBanner } from "./ProductFormCreatedBanner";
import { useProductForm } from "../../hooks/useProductForm";
import { pfPageBg, pfShell } from "./productFormUi";
import type { ProductFormMode, ProductFormTab } from "../../types";

const FORM_ID = "product-main-form";

function parseInitialTab(value: string | null): ProductFormTab {
  if (
    value === "general" ||
    value === "detalle" ||
    value === "costes" ||
    value === "documentacion" ||
    value === "variantes" ||
    value === "amazon" ||
    value === "benchmarking"
  ) {
    return value;
  }
  return "general";
}

type ProductFormPageProps = {
  mode: ProductFormMode;
  productId?: string;
};

export function ProductFormPage({
  mode,
  productId,
}: ProductFormPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const variantParentId = searchParams.get("parent_id");
  const createdFromQuery = searchParams.get("created") === "1";

  const form = useProductForm({ mode, productId, variantParentId });

  const [activeTab, setActiveTab] = useState<ProductFormTab>(() =>
    parseInitialTab(searchParams.get("tab")),
  );
  const [showCreatedBanner, setShowCreatedBanner] = useState(createdFromQuery);

  const busy = form.saving || form.uploadingImage;

  const dismissCreatedBanner = useCallback(() => {
    setShowCreatedBanner(false);
    if (!productId) return;
    router.replace(`/productos/${productId}/edit`);
  }, [productId, router]);

  const openTab = useCallback((tab: ProductFormTab) => {
    setActiveTab(tab);
  }, []);

  const heading = useMemo(() => {
    if (form.isEditMode && showCreatedBanner) return "Editar producto";
    if (form.isEditMode) return "Editar producto";
    if (form.isVariant) return "Nueva variante";
    return "Nuevo producto";
  }, [form.isEditMode, form.isVariant, showCreatedBanner]);

  const subtitle = useMemo(() => {
    if (form.isEditMode && showCreatedBanner) {
      return "Producto creado correctamente. Completa el resto de datos o usa las acciones rápidas.";
    }
    if (form.isVariant) {
      return "Los datos heredables del padre ya están precargados. Define identidad propia de la variante.";
    }
    return "Datos ERP y configuración comercial. Completa cada bloque y guarda cuando esté listo.";
  }, [form.isEditMode, form.isVariant, showCreatedBanner]);

  if (form.loading) {
    return (
      <div className={pfPageBg}>
        <div className={pfShell}>
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">
            Cargando producto…
          </div>
        </div>
      </div>
    );
  }

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
    <div className={pfPageBg}>
      <div className={pfShell}>
        <header className="mb-8 flex flex-col gap-4 border-b border-slate-200/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={form.cancel}
              disabled={busy}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-50"
              aria-label="Volver al listado"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                {heading}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">{subtitle}</p>
            </div>
          </div>
          <button
            type="submit"
            form={FORM_ID}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-60"
          >
            {primaryLabel}
          </button>
        </header>

        {form.globalError ? (
          <div
            className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
            role="alert"
          >
            {form.globalError}
          </div>
        ) : null}

        {form.globalWarning ? (
          <div
            className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
            role="status"
          >
            {form.globalWarning}
          </div>
        ) : null}

        {showCreatedBanner && form.isEditMode && form.productId ? (
          <ProductFormCreatedBanner
            productId={form.productId}
            parentId={form.values.parentId || null}
            onOpenTab={openTab}
            onDismiss={dismissCreatedBanner}
          />
        ) : null}

        <ProductForm
          form={form}
          formId={FORM_ID}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      </div>
    </div>
  );
}
