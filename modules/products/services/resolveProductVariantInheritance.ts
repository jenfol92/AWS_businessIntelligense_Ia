import type { ProductInheritanceOverrides } from "../types/product-inheritance.types";

const PRODUCT_FORM_ESPECIFICACIONES_KEY = "form_extensions_v1";

export type ProductInheritanceBundle = {
  core: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
  logistics: Record<string, unknown> | null;
  technicalSheet: Record<string, unknown> | null;
};

export type ResolvedProductVariantInheritance = ProductInheritanceBundle & {
  overrides: ProductInheritanceOverrides;
};

const FIELD_COLUMNS = {
  referenciaFabricante: ["core", "especificaciones.form_extensions_v1.identifiers.referencia_fabricante"],
  categoriaId: ["detail", "categoria_id"],
  unidadesPorCaja: ["logistics", "unidades_por_caja"],
  pedidoMinimoUnidades: ["logistics", "pedido_minimo_unidades"],
  materialEstructura: ["technicalSheet", "material_estructura"],
  materialTapizado: ["technicalSheet", "material_tapizado"],
  materialRuedas: ["technicalSheet", "material_ruedas"],
  pesoNetoKg: ["technicalSheet", "peso_neto_kg"],
  pesoBrutoKg: ["logistics", "peso_kg_bruto"],
  altoCajaCm: ["logistics", "alto_cm"],
  anchoCajaCm: ["logistics", "ancho_cm"],
  largoCajaCm: ["logistics", "largo_cm"],
  altoAbiertoCm: ["technicalSheet", "alto_abierto_cm"],
  anchoAbiertoCm: ["technicalSheet", "ancho_abierto_cm"],
  fondoAbiertoCm: ["technicalSheet", "fondo_abierto_cm"],
  altoPlegadoCm: ["technicalSheet", "alto_plegado_cm"],
  anchoPlegadoCm: ["technicalSheet", "ancho_plegado_cm"],
  fondoPlegadoCm: ["technicalSheet", "fondo_plegado_cm"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]));
  return value;
}

export function deepMergeParentWithOverrides(parent: unknown, child: unknown): unknown {
  if (!isRecord(parent)) return child == null ? clone(parent) : clone(child);
  if (!isRecord(child)) return clone(parent);
  const out = clone(parent) as Record<string, unknown>;
  for (const [key, value] of Object.entries(child)) {
    if (value === null || value === undefined) continue;
    out[key] = isRecord(value) && isRecord(out[key])
      ? deepMergeParentWithOverrides(out[key], value)
      : clone(value);
  }
  return out;
}

function getPath(record: Record<string, unknown> | null, path: string): unknown {
  let current: unknown = record;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function hasOverride(value: unknown): boolean {
  return value !== null && value !== undefined;
}

function mergeRow(
  child: Record<string, unknown> | null,
  parent: Record<string, unknown> | null,
  productId: string,
): Record<string, unknown> | null {
  if (!child && !parent) return null;
  const merged = deepMergeParentWithOverrides(parent ?? {}, child ?? {}) as Record<string, unknown>;
  if (!child) delete merged.id;
  merged.producto_id = child?.producto_id ?? productId;
  return merged;
}

export function resolveProductVariantInheritance(params: {
  productId: string;
  child: ProductInheritanceBundle;
  parent: ProductInheritanceBundle | null;
}): ResolvedProductVariantInheritance {
  const { child, parent, productId } = params;
  if (!parent) {
    return { ...child, overrides: { fields: {}, categorySpecifications: {} } };
  }

  const fields: ProductInheritanceOverrides["fields"] = {};
  for (const [field, [bundleKey, path]] of Object.entries(FIELD_COLUMNS)) {
    fields[field as keyof typeof fields] = hasOverride(
      getPath(child[bundleKey as keyof ProductInheritanceBundle], path),
    );
  }

  const childSpecs = isRecord(child.core?.especificaciones) ? child.core.especificaciones : {};
  const parentSpecs = isRecord(parent.core?.especificaciones) ? parent.core.especificaciones : {};
  const categorySpecifications: Record<string, boolean> = {};
  for (const key of Array.from(new Set([...Object.keys(parentSpecs), ...Object.keys(childSpecs)]))) {
    if (key === PRODUCT_FORM_ESPECIFICACIONES_KEY) continue;
    categorySpecifications[key] = Object.prototype.hasOwnProperty.call(childSpecs, key)
      && childSpecs[key] !== null && childSpecs[key] !== undefined;
  }

  const core = {
    ...(parent.core ?? {}),
    ...(child.core ?? {}),
    especificaciones: deepMergeParentWithOverrides(parentSpecs, childSpecs),
  };

  return {
    core,
    detail: mergeRow(child.detail, parent.detail, productId),
    logistics: mergeRow(child.logistics, parent.logistics, productId),
    technicalSheet: mergeRow(child.technicalSheet, parent.technicalSheet, productId),
    overrides: { fields, categorySpecifications },
  };
}
