"use client";

import type { useProductForm } from "../../hooks/useProductForm";
import type { ProductInheritableField } from "../../types/product-inheritance.types";

type Props = {
  form: ReturnType<typeof useProductForm>;
  field: ProductInheritableField;
};

export function InheritanceOverrideControl({ form, field }: Props) {
  if (!form.isVariant) return null;
  const overridden = form.values.inheritanceOverrides.fields[field] === true;
  return (
    <div className="mt-1 flex items-center gap-2 text-xs">
      <span className={overridden ? "text-amber-700" : "text-blue-700"}>
        {overridden ? "Personalizado" : "Heredado del padre"}
      </span>
      {overridden ? (
        <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => form.inheritFieldFromParent(field)}>
          Volver a heredar
        </button>
      ) : (
        <button type="button" className="font-medium text-slate-700 hover:underline" onClick={() => form.personalizeInheritedField(field)}>
          Personalizar
        </button>
      )}
    </div>
  );
}
