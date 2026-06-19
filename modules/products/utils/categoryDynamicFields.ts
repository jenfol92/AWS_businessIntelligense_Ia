/**
 * Utilidades para campos dinámicos de categoría en `productos.especificaciones`.
 */

import { PRODUCT_FORM_ESPECIFICACIONES_KEY } from "../constants";
import type {
  ProductFormFieldConfig,
  ProductFormFieldValue,
} from "../types/product-form.types";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Extrae valores dinámicos del JSON raíz (excluye claves internas del formulario). */
export function extractCategoryDynamicFieldsFromEspecificaciones(
  especificaciones: unknown,
): Record<string, ProductFormFieldValue> {
  const root = asRecord(especificaciones);
  if (!root) return {};

  const out: Record<string, ProductFormFieldValue> = {};
  for (const [key, val] of Object.entries(root)) {
    if (key === PRODUCT_FORM_ESPECIFICACIONES_KEY) continue;
    if (
      val === null ||
      typeof val === "string" ||
      typeof val === "number" ||
      typeof val === "boolean" ||
      (Array.isArray(val) && val.every((x) => typeof x === "string"))
    ) {
      out[key] = val as ProductFormFieldValue;
    }
  }
  return out;
}

/** Fusiona campos dinámicos en especificaciones preservando extensiones y otras claves. */
export function mergeCategoryFieldsIntoEspecificaciones(
  existing: unknown,
  dynamicFields: Record<string, ProductFormFieldValue>,
  fieldKeys: string[],
  formExtension: Record<string, unknown>,
): Record<string, unknown> {
  const root = { ...(asRecord(existing) ?? {}) };

  for (const key of fieldKeys) {
    if (Object.prototype.hasOwnProperty.call(dynamicFields, key)) {
      root[key] = dynamicFields[key];
    }
  }

  root[PRODUCT_FORM_ESPECIFICACIONES_KEY] = formExtension;
  return root;
}

function isCategoryDynamicFieldEmpty(
  val: ProductFormFieldValue | undefined,
): boolean {
  return (
    val == null ||
    val === "" ||
    (Array.isArray(val) && val.length === 0)
  );
}

/** Campos marcados como requeridos en categoría pero aún sin valor (solo informativo). */
export function getPendingCategoryDynamicFields(
  fields: ProductFormFieldConfig[],
  values: Record<string, ProductFormFieldValue>,
): ProductFormFieldConfig[] {
  return fields.filter(
    (field) => field.required && isCategoryDynamicFieldEmpty(values[field.key]),
  );
}

/** Valida formato y rangos numéricos; no bloquea por campos requeridos vacíos. */
export function validateCategoryDynamicFields(
  fields: ProductFormFieldConfig[],
  values: Record<string, ProductFormFieldValue>,
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of fields) {
    const val = values[field.key];

    if (field.type === "number" && val != null && val !== "") {
      const n = Number(val);
      if (!Number.isFinite(n)) {
        errors[field.key] = `${field.label} debe ser numérico`;
        continue;
      }
      const min = field.validation?.min;
      const max = field.validation?.max;
      if (min != null && n < min) {
        errors[field.key] = `${field.label} debe ser >= ${min}`;
      }
      if (max != null && n > max) {
        errors[field.key] = `${field.label} debe ser <= ${max}`;
      }
    }
  }

  return errors;
}
