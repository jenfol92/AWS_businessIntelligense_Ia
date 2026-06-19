// modules/products/components/ProductCatalogHeader.tsx

"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

export function ProductCatalogHeader() {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Catálogo de productos
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Vista operativa de productos, stock, margen, ACOS, cobertura y riesgo.
        </p>
      </div>
      <button
        type="button"
        onClick={() => router.push("/productos/new")}
        className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 sm:self-auto"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Nuevo producto
      </button>
    </div>
  );
}
