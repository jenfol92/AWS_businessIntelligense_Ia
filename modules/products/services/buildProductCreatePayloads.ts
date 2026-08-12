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

function cloneJsonLike(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneJsonLike);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJsonLike(child)]),
    );
  }
  return value;
}

function pickInheritedColumns(
  parent: Record<string, unknown> | null,
  columns: string[],
): Record<string, unknown> {
  if (!parent) return {};
  return Object.fromEntries(
    columns
      .filter((key) => parent[key] !== undefined)
      .map((key) => [key, cloneJsonLike(parent[key])]),
  );
}

function asSpecs(value: unknown): Record<string, unknown> {
  return isRecord(value) ? (cloneJsonLike(value) as Record<string, unknown>) : {};
}

function inheritCorePayload(
  child: Record<string, unknown>,
  parent: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!parent) return child;

  const childSpecs = asSpecs(child.especificaciones);
  const childExtension = isRecord(childSpecs[PRODUCT_FORM_ESPECIFICACIONES_KEY])
    ? childSpecs[PRODUCT_FORM_ESPECIFICACIONES_KEY]
    : {};
  const childIdentifiers = isRecord(childExtension.identifiers)
    ? childExtension.identifiers
    : {};
  const childAmazon = isRecord(childExtension.amazon) ? childExtension.amazon : {};
  const childPublication = isRecord(childAmazon.publication)
    ? childAmazon.publication
    : {};

  const parentSpecs = asSpecs(parent.especificaciones);
  const parentExtension = isRecord(parentSpecs[PRODUCT_FORM_ESPECIFICACIONES_KEY])
    ? (parentSpecs[PRODUCT_FORM_ESPECIFICACIONES_KEY] as Record<string, unknown>)
    : {};
  const inheritedExtension = {
    ...parentExtension,
    identifiers: {
      ...(isRecord(parentExtension.identifiers)
        ? (cloneJsonLike(parentExtension.identifiers) as Record<string, unknown>)
        : {}),
      ean: childIdentifiers.ean ?? null,
      referencia_fabricante: childIdentifiers.referencia_fabricante ?? null,
      codigo_proveedor: childIdentifiers.codigo_proveedor ?? null,
    },
    amazon: {
      ...(isRecord(parentExtension.amazon)
        ? (cloneJsonLike(parentExtension.amazon) as Record<string, unknown>)
        : {}),
      publication: {
        ...(isRecord(
          isRecord(parentExtension.amazon)
            ? parentExtension.amazon.publication
            : null,
        )
          ? (cloneJsonLike(
              (parentExtension.amazon as Record<string, unknown>).publication,
            ) as Record<string, unknown>)
          : {}),
        asin: childPublication.asin ?? null,
        sku: childPublication.sku ?? null,
        last_sync_at: childPublication.last_sync_at ?? null,
        listing_status: childPublication.listing_status ?? "draft",
        sync_enabled: childPublication.sync_enabled ?? false,
      },
    },
  };

  const inheritedSpecs = {
    ...parentSpecs,
    [PRODUCT_FORM_ESPECIFICACIONES_KEY]: inheritedExtension,
  };
  for (const [key, value] of Object.entries(childSpecs)) {
    if (key === PRODUCT_FORM_ESPECIFICACIONES_KEY) continue;
    inheritedSpecs[key] = cloneJsonLike(value);
  }

  return {
    ...pickInheritedColumns(parent, [
      "proveedor_id",
      "stock_seguridad_minimo",
      "arancel_porcentaje",
    ]),
    sku: child.sku,
    nombre: child.nombre,
    asin: child.asin,
    estado: child.estado,
    parent_id: child.parent_id,
    heredar_precio: child.heredar_precio,
    heredar_coste_unitario_total: child.heredar_coste_unitario_total,
    tax_category_id: child.tax_category_id,
    especificaciones: inheritedSpecs,
  };
}

function inheritDetailPayload(
  child: Record<string, unknown>,
  parent: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!parent) return child;
  return {
    ...pickInheritedColumns(parent, [
      "categoria_id",
      "categoria",
      "marca",
      "descripcion_tecnica",
    ]),
    categoria_id: child.categoria_id,
    categoria: child.categoria,
    marca: child.marca,
    descripcion_tecnica: child.descripcion_tecnica,
    imagen_url: child.imagen_url,
    color: child.color,
  };
}

function inheritLogisticsPayload(
  child: Record<string, unknown>,
  parent: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!parent) return child;
  return {
    ...pickInheritedColumns(parent, [
      "unidades_por_caja",
      "peso_kg_bruto",
      "pedido_minimo_unidades",
      "largo_cm",
      "ancho_cm",
      "alto_cm",
    ]),
    unidades_por_caja: child.unidades_por_caja,
    peso_kg_bruto: child.peso_kg_bruto,
    pedido_minimo_unidades: child.pedido_minimo_unidades,
    largo_cm: child.largo_cm,
    ancho_cm: child.ancho_cm,
    alto_cm: child.alto_cm,
    ean_upc: child.ean_upc,
  };
}

function inheritTechnicalSheetPayload(
  child: Record<string, unknown>,
  parent: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!parent) return child;
  return {
    ...pickInheritedColumns(parent, [
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
    ]),
    ...child,
  };
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

  const overrides = values.inheritanceOverrides;
  const inheritedCore = inheritCorePayload(corePayload, parent.core);
  const specs = asSpecs(inheritedCore.especificaciones);
  for (const key of Object.keys(specs)) {
    if (key === PRODUCT_FORM_ESPECIFICACIONES_KEY) continue;
    if (!overrides.categorySpecifications[key]) delete specs[key];
  }
  const extension = isRecord(specs[PRODUCT_FORM_ESPECIFICACIONES_KEY])
    ? { ...(specs[PRODUCT_FORM_ESPECIFICACIONES_KEY] as Record<string, unknown>) }
    : {};
  const identifiers = isRecord(extension.identifiers) ? { ...extension.identifiers } : {};
  if (!overrides.fields.referenciaFabricante) delete identifiers.referencia_fabricante;
  extension.identifiers = identifiers;
  specs[PRODUCT_FORM_ESPECIFICACIONES_KEY] = extension;

  const inheritedDetail = inheritDetailPayload(detailPayload, parent.detail);
  if (!overrides.fields.categoriaId) {
    inheritedDetail.categoria_id = null;
    inheritedDetail.categoria = null;
  }

  const inheritedLogistics = inheritLogisticsPayload(logisticsPayload, parent.logistics);
  const logisticsFields = {
    unidadesPorCaja: "unidades_por_caja",
    pedidoMinimoUnidades: "pedido_minimo_unidades",
    pesoBrutoKg: "peso_kg_bruto",
    largoCajaCm: "largo_cm",
    anchoCajaCm: "ancho_cm",
    altoCajaCm: "alto_cm",
  } as const;
  for (const [field, column] of Object.entries(logisticsFields)) {
    if (!overrides.fields[field as keyof typeof overrides.fields]) inheritedLogistics[column] = null;
  }

  const inheritedTechnical = inheritTechnicalSheetPayload(technicalSheetPayload, parent.technicalSheet);
  const technicalFields = {
    materialEstructura: "material_estructura",
    materialTapizado: "material_tapizado",
    materialRuedas: "material_ruedas",
    pesoNetoKg: "peso_neto_kg",
    altoAbiertoCm: "alto_abierto_cm",
    anchoAbiertoCm: "ancho_abierto_cm",
    fondoAbiertoCm: "fondo_abierto_cm",
    altoPlegadoCm: "alto_plegado_cm",
    anchoPlegadoCm: "ancho_plegado_cm",
    fondoPlegadoCm: "fondo_plegado_cm",
  } as const;
  for (const [field, column] of Object.entries(technicalFields)) {
    if (!overrides.fields[field as keyof typeof overrides.fields]) inheritedTechnical[column] = null;
  }

  return {
    corePayload: { ...inheritedCore, especificaciones: specs },
    detailPayload: inheritedDetail,
    logisticsPayload: inheritedLogistics,
    financePayload,
    technicalSheetPayload: inheritedTechnical,
  };
}
