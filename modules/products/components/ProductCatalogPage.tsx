// modules/products/components/ProductCatalogPage.tsx

"use client";

import { useProductCatalog } from "../hooks/useProductCatalog";
import { ProductCatalogHeader } from "./ProductCatalogHeader";
import { ProductCatalogToolbar } from "./ProductCatalogToolbar";
import { ProductCatalogStats } from "./ProductCatalogStats";
import { ProductCatalogTable } from "./ProductCatalogTable";

export function ProductCatalogPage() {
  const catalog = useProductCatalog();

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-6 px-4 pb-12 sm:px-6 lg:px-8">
      <ProductCatalogHeader />

      <ProductCatalogToolbar
  search={catalog.search}
  onSearchChange={catalog.setSearch}
  onReload={catalog.reload}
  selectedAgentIds={catalog.selectedAgentIds}
  onSelectedAgentIdsChange={catalog.setSelectedAgentIds}
  selectedPorts={catalog.selectedPorts}
  onSelectedPortsChange={catalog.setSelectedPorts}
  selectedStates={catalog.selectedStates}
onSelectedStatesChange={catalog.setSelectedStates}
  selectedCategories={catalog.selectedCategories}
  onSelectedCategoriesChange={catalog.setSelectedCategories}
  options={catalog.options}
  loadingOptions={catalog.loadingOptions}
/>
      {catalog.error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {catalog.error}
        </div>
      )}

      <ProductCatalogStats rows={catalog.rows} />

      <ProductCatalogTable
        rows={catalog.visibleRows}
        totalRows={catalog.rows.length}
        loading={catalog.loading}
        showAll={catalog.showAll}
        hasHiddenRows={catalog.hasHiddenRows}
        onShowAll={() => catalog.setShowAll(true)}
        onShowLess={() => catalog.setShowAll(false)}
      />
    </div>
  );
}