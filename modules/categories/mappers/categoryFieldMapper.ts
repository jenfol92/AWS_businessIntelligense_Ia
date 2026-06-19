import type { ProductFormFieldConfig } from "@/modules/products/types/product-form.types";
import type {
  CategoryCamposConfig,
  CategoryFieldDefinition,
} from "../types/category.types";

const SUPPORTED_TYPES = new Set([
  "text",
  "number",
  "boolean",
  "select",
  "multi-select",
  "textarea",
]);

function mapFieldType(tipo: string): ProductFormFieldConfig["type"] {
  const t = tipo.trim().toLowerCase();
  if (SUPPORTED_TYPES.has(t)) {
    return t as ProductFormFieldConfig["type"];
  }
  return "text";
}

/** Convierte un campo de `campos_config.campos` al contrato del formulario de producto. */
export function mapCategoryFieldToFormConfig(
  field: CategoryFieldDefinition,
): ProductFormFieldConfig {
  return {
    key: field.key,
    label: field.label,
    type: mapFieldType(field.tipo),
    required: field.requerido === true,
    unit: field.unidad,
    placeholder: field.placeholder,
    options: field.opciones,
    aiHelp: field.ayuda_ia,
    validation: field.validacion
      ? {
          min: field.validacion.min,
          max: field.validacion.max,
          pattern: field.validacion.pattern,
          maxLength: field.validacion.maxLength,
        }
      : undefined,
  };
}

/** Lista de campos del formulario para la categoría seleccionada. */
export function mapCategoryCamposToFormFields(
  config: CategoryCamposConfig | null | undefined,
): ProductFormFieldConfig[] {
  const campos = config?.campos;
  if (!Array.isArray(campos)) return [];
  return campos
    .filter((c) => c.key && c.label)
    .map(mapCategoryFieldToFormConfig);
}
