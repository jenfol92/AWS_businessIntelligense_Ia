"use client";

import type { AmazonMarketplaceCatalog } from "../../../types/product-amazon.types";
import { formatMarketplaceDisplayName } from "./productAmazonHelpers";

type Props = {
  assignedIds: string[];
  activeId: string | null;
  catalog: AmazonMarketplaceCatalog[];
  onSelect: (marketplaceId: string) => void;
};

export function ProductAmazonMarketplaceTabs({
  assignedIds,
  activeId,
  catalog,
  onSelect,
}: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-1.5">
      <div
        className="flex flex-wrap gap-1"
        role="tablist"
        aria-label="Marketplace activo"
      >
        {assignedIds.map((id) => {
          const row = catalog.find((c) => c.id === id);
          const label = formatMarketplaceDisplayName(row, id);
          const isActive = activeId === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                isActive
                  ? "bg-white text-blue-700 shadow-sm ring-1 ring-slate-200/80"
                  : "text-slate-600 hover:bg-white/80 hover:text-slate-900"
              }`}
              onClick={() => onSelect(id)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
