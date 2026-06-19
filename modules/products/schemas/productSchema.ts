// modules/products/schemas/productSchema.ts

import type {
  ProductFormErrors,
  ProductFormFieldConfig,
  ProductFormValues,
} from "../types";
import { validateCategoryDynamicFields } from "../utils/categoryDynamicFields";

export type ValidateProductFormOptions = {
  categoryFields?: ProductFormFieldConfig[];
};

// Validaciones bloqueantes mínimas (avisos Amazon van aparte).
// Los campos dinámicos de categoría solo bloquean por formato/rango, no por vacíos.

export function validateProductForm(
  values: ProductFormValues,
  options?: ValidateProductFormOptions,
): ProductFormErrors {
  const errors: ProductFormErrors = {};

  if (!values.sku.trim()) {
    errors.sku = "El SKU es obligatorio";
  }

  if (!values.nombre.trim()) {
    errors.nombre = "El nombre del producto es obligatorio";
  }

  if (!values.categoriaId.trim()) {
    errors.categoriaId = "La categoría es obligatoria";
  }

  const categoryFields = options?.categoryFields ?? [];
  const dynamicErrors = validateCategoryDynamicFields(
    categoryFields,
    values.categoryDynamicFields,
  );
  if (Object.keys(dynamicErrors).length > 0) {
    errors.dynamicFields = dynamicErrors;
  }

  if (values.precioVentaBase < 0) {
    errors.precioVentaBase = "El precio no puede ser negativo";
  }

  return errors;
}

export function hasProductFormErrors(errors: ProductFormErrors): boolean {
  const { dynamicFields, ...rest } = errors;
  if (dynamicFields && Object.keys(dynamicFields).length > 0) return true;
  return Object.keys(rest).length > 0;
}
