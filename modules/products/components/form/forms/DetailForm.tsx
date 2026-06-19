"use client";

import type { useProductForm } from "../../../hooks/useProductForm";
import { ProductFormDetailSection } from "../sections/ProductFormDetailSection";
import { ProductFormCategorySection } from "../sections/ProductFormCategorySection";
import { ProductFormLogisticsSection } from "../sections/ProductFormLogisticsSection";
import { ProductFormFichaSection } from "../sections/ProductFormFichaSection";

type Props = {
  form: ReturnType<typeof useProductForm>;
};

/** Detalle técnico, logística, ficha y campos dinámicos de categoría. */
export function DetailForm({ form }: Props) {
  return (
    <div className="space-y-6">
      <ProductFormDetailSection form={form} />
      <ProductFormCategorySection form={form} mode="dynamic" />
      <ProductFormLogisticsSection form={form} />
      <ProductFormFichaSection form={form} />
    </div>
  );
}
