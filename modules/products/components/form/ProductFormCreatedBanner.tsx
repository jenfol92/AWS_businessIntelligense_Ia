"use client";

import type { ProductFormTab } from "../../types";
import { AddVariantActions } from "../AddVariantActions";

type Props = {
  productId: string;
  parentId?: string | null;
  onOpenTab: (tab: ProductFormTab) => void;
  onDismiss: () => void;
};

export function ProductFormCreatedBanner({
  productId,
  parentId,
  onOpenTab,
  onDismiss,
}: Props) {
  return (
    <section
      className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4 shadow-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-emerald-900">
            Producto creado correctamente.
          </p>
          <p className="mt-1 text-sm text-emerald-800">
            Ahora estás editando el producto recién creado. Puedes completar
            datos, subir documentación o crear variantes.
          </p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 self-start text-xs font-medium text-emerald-800 underline-offset-2 hover:underline"
        >
          Cerrar aviso
        </button>
      </div>

      <div className="mt-4 space-y-3">
        <AddVariantActions
          productId={productId}
          parentId={parentId}
          layout="banner"
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onOpenTab("documentacion")}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-emerald-300 bg-white px-4 py-2 text-sm font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-100/60"
          >
            Subir documentación
          </button>
        </div>
      </div>
    </section>
  );
}
