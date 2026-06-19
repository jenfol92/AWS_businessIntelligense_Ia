"use client";

import type { ProductFormTab } from "../../types";
import { twMerge } from "tailwind-merge";

const TABS: { id: ProductFormTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "detalle", label: "Detalles" },
  { id: "costes", label: "Costes" },
  { id: "documentacion", label: "Documentación" },
  { id: "variantes", label: "Variantes" },
  { id: "amazon", label: "Amazon" },
  { id: "benchmarking", label: "Benchmarking" },
];

type Props = {
  activeTab: ProductFormTab;
  onTabChange: (tab: ProductFormTab) => void;
  isVariant: boolean;
  documentsEnabled: boolean;
  benchmarkingEnabled: boolean;
};

export function ProductFormShell({
  activeTab,
  onTabChange,
  isVariant,
  documentsEnabled,
  benchmarkingEnabled,
}: Props) {
  const visibleTabs = TABS.filter((t) => {
    if (t.id === "variantes") return isVariant;
    return true;
  });

  return (
    <nav
      className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
      aria-label="Secciones del formulario"
    >
      {visibleTabs.map((tab) => {
        const isDocsLocked = tab.id === "documentacion" && !documentsEnabled;
        const isBenchmarkingLocked =
          tab.id === "benchmarking" && !benchmarkingEnabled;
        const isLocked = isDocsLocked || isBenchmarkingLocked;
        return (
          <button
            key={tab.id}
            type="button"
            disabled={isLocked}
            title={
              isDocsLocked
                ? "Guarda primero el producto para poder subir documentación."
                : isBenchmarkingLocked
                  ? "Guarda primero el producto para poder configurar benchmarking y competidores."
                  : undefined
            }
            onClick={() => {
              if (isLocked) return;
              onTabChange(tab.id);
            }}
            className={twMerge(
              "shrink-0 rounded-lg px-4 py-2.5 text-sm font-medium transition",
              activeTab === tab.id
                ? "bg-blue-600 text-white shadow-sm"
                : isLocked
                  ? "cursor-not-allowed text-slate-400 opacity-60"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}

export { TABS as PRODUCT_FORM_TABS };
