import type { ProductFormValues } from "../types";
import { PRODUCT_FORM_ESPECIFICACIONES_KEY } from "../constants";
import {
  mapProductFormToCorePayload,
  mapProductFormToDetailPayload,
  mapProductFormToFinancePayload,
  mapProductFormToLogisticsPayload,
  mapProductFormToTechnicalSheetPayload,
} from "../mappers/productFormMapper";

type ParentInheritanceRows = {
  core: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
  logistics: Record<string, unknown> | null;
  technicalSheet: Record<string, unknown> | null;
};

export type ProductCreatePayloads = {
  corePayload: Record<string, unknown>;
  detailPayload: Record<string, unknown>;
  logisticsPayload: Record<string, unknown>;
  financePayload: Record<string, unknown> | null;
  technicalSheetPayload: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isEmptyValue(value: unknown, opts?: { zeroIsEmpty?: boolean }): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "number") return opts?.zeroIsEmpty === true && value === 0;
  if (isRecord(value)) return Object.keys(value).length === 0;
  return false;
}

function cloneJsonLike(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonLike);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonLike(child)]),
    );
  }
  return value;
}

function mergeMissingDeep(
  child: unknown,
  parent: unknown,
  opts?: { zeroIsEmpty?: boolean },
): unknown {
  if (isEmptyValue(child, opts)) return cloneJsonLike(parent);
  if (!isRecord(child) || !isRecord(parent)) return child;

  const out: Record<string, unknown> = { ...child };
  for (const [key, parentValue] of Object.entries(parent)) {
    out[key] = mergeMissingDeep(out[key], parentValue, opts);
  }
  return out;
}

function mergeMissingColumns(
  child: Record<string, unknown>,
  parent: Record<string, unknown> | null,
  columns: string[],
  opts?: { zeroIsEmpty?: boolean },
): Record<string, unknown> {
  if (!parent) return child;
  const out = { ...child };
  for (const key of columns) {
    if (!isEmptyValue(out[key], opts)) continue;
    const parentValue = parent[key];
    if (isEmptyValue(parentValue, opts)) continue;
    out[key] = cloneJsonLike(parentValue);
  }
  return out;
}

function inheritCorePayload(
  child: Record<string, unknown>,
  parent: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!parent) return child;

  const merged = mergeMissingColumns(child, parent, [
    "proveedor_id",
    "stock_seguridad_minimo",
    "arancel_porcentaje",
  ], { zeroIsEmpty: true });

  merged.especificaciones = mergeMissingDeep(
    child.especificaciones,
    parent.especificaciones,
  );

  const specs = isRecord(merged.especificaciones)
    ? { ...merged.especificaciones }
    : {};
  const formExtension = specs[PRODUCT_FORM_ESPECIFICACIONES_KEY];
  if (isRecord(formExtension)) {
    specs[PRODUCT_FORM_ESPECIFICACIONES_KEY] = mergeMissingDeep(
      formExtension,
      isRecord(parent.especificaciones)
        ? parent.especificaciones[PRODUCT_FORM_ESPECIFICACIONES_KEY]
        : null,
    );
    merged.especificaciones = specs;
  }

  return merged;
}

function inheritDetailPayload(
  child: Record<string, unknown>,
  parent: Record<string, unknown> | null,
): Record<string, unknown> {
  return mergeMissingColumns(child, parent, [
    "categoria_id",
    "categoria",
    "marca",
    "descripcion_tecnica",
  ]);
}

function inheritLogisticsPayload(
  child: Record<string, unknown>,
  parent: Record<string, unknown> | null,
): Record<string, unknown> {
  return mergeMissingColumns(child, parent, [
    "unidades_por_caja",
    "peso_kg_bruto",
    "pedido_minimo_unidades",
    "largo_cm",
    "ancho_cm",
    "alto_cm",
  ], { zeroIsEmpty: true });
}

function inheritTechnicalSheetPayload(
  child: Record<string, unknown>,
  parent: Record<string, unknown> | null,
): Record<string, unknown> {
  return mergeMissingColumns(child, parent, [
    "modelo",
    "peso_neto_kg",
    "alto_abierto_cm",
    "ancho_abierto_cm",
    "fondo_abierto_cm",
    "alto_plegado_cm",
    "ancho_plegado_cm",
    "fondo_plegado_cm",
    "material_estructura",
    "material_tapizado",
    "material_ruedas",
    "edad_minima_aplicable",
    "edad_maxima_aplicable",
  ], { zeroIsEmpty: true });
}

export function buildProductCreatePayloads(
  values: ProductFormValues,
  parent: ParentInheritanceRows = {
    core: null,
    detail: null,
    logistics: null,
    technicalSheet: null,
  },
): ProductCreatePayloads {
  const isVariant = values.parentId.trim() !== "";
  const corePayload = mapProductFormToCorePayload(values, null);
  const detailPayload = mapProductFormToDetailPayload(values);
  const logisticsPayload = mapProductFormToLogisticsPayload(values);
  const financePayload =
    values.heredarPrecio && values.parentId.trim()
      ? null
      : mapProductFormToFinancePayload(values);
  const technicalSheetPayload = mapProductFormToTechnicalSheetPayload(values);

  if (!isVariant) {
    return {
      corePayload,
      detailPayload,
      logisticsPayload,
      financePayload,
      technicalSheetPayload,
    };
  }

  return {
    corePayload: inheritCorePayload(corePayload, parent.core),
    detailPayload: inheritDetailPayload(detailPayload, parent.detail),
    logisticsPayload: inheritLogisticsPayload(logisticsPayload, parent.logistics),
    financePayload,
    technicalSheetPayload: inheritTechnicalSheetPayload(
      technicalSheetPayload,
      parent.technicalSheet,
    ),
  };
}
