// modules/products/mappers/productFormMapper.ts

import type { ProductFormValues } from "../types";
import { PRODUCT_FORM_ESPECIFICACIONES_KEY } from "../constants";
import { mergeCategoryFieldsIntoEspecificaciones } from "../utils/categoryDynamicFields";
import {
  pickPrimaryMarketplaceDraft,
} from "./amazonSetupMapper";
import { positiveMeasureOrNull } from "../utils/positiveMeasureOrNull";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function str(v: string): string {
  return v.trim();
}

function buildFormExtension(values: ProductFormValues): Record<string, unknown> {
  const primary = pickPrimaryMarketplaceDraft(values.amazonSetup);
  const amazonContentFields = primary
    ? {
        title: primary.draft.title,
        brand: primary.draft.brand,
        description: primary.draft.description,
        bullet1: primary.draft.bullet1,
        bullet2: primary.draft.bullet2,
        bullet3: primary.draft.bullet3,
        bullet4: primary.draft.bullet4,
        bullet5: primary.draft.bullet5,
        keywords: primary.draft.keywords,
        target_audience: primary.draft.targetAudience,
        search_terms: primary.draft.searchTerms,
        product_type: primary.draft.productType,
        browse_node_id: primary.draft.browseNodeId,
        condition_type: primary.draft.conditionType,
        language: primary.draft.languageCode,
        marketplace: primary.draft.marketplaceCode ?? values.amazonMarketplace,
      }
    : {
        title: values.amazonTitle,
        brand: values.amazonBrand,
        description: values.amazonDescription,
        bullet1: values.amazonBullet1,
        bullet2: values.amazonBullet2,
        bullet3: values.amazonBullet3,
        bullet4: values.amazonBullet4,
        bullet5: values.amazonBullet5,
        keywords: values.amazonKeywords,
        target_audience: values.amazonTargetAudience,
        search_terms: values.amazonSearchTerms,
        product_type: values.amazonProductType,
        browse_node_id: values.amazonBrowseNodeId,
        condition_type: values.amazonConditionType,
        language: values.amazonLanguage,
        marketplace: values.amazonMarketplace,
      };

  const amazonPublicationFields = primary
    ? {
        sync_enabled: primary.draft.syncEnabled,
        listing_status: primary.draft.listingStatus,
        last_sync_at: primary.draft.lastSyncAt.trim() || null,
        asin: primary.draft.listingAsin.trim() || null,
        sku: primary.draft.listingSku.trim() || null,
      }
    : {
        sync_enabled: values.amazonSyncEnabled,
        listing_status: values.amazonListingStatus,
        last_sync_at: str(values.amazonLastSyncAt) || null,
        asin: str(values.amazonListingAsin) || null,
        sku: str(values.amazonListingSku) || null,
      };

  return {
    identifiers: {
      ean: str(values.ean) || null,
      referencia_fabricante: str(values.referenciaFabricante) || null,
      codigo_proveedor: str(values.codigoProveedor) || null,
    },
    price_channel: str(values.priceChannel) || null,
    notas_generales: str(values.notasGenerales) || null,
    amazon: {
      content: amazonContentFields,
      publication: amazonPublicationFields,
    },
  };
}

/**
 * Fila `productos`: núcleo + `especificaciones` enriquecidas sin pisar claves ajenas.
 */
export function mapProductFormToCorePayload(
  values: ProductFormValues,
  existingEspecificaciones: unknown = null,
  categoryFieldKeys?: string[],
): Record<string, unknown> {
  const keys =
    categoryFieldKeys ??
    (values.categoryActiveFieldKeys.length > 0
      ? values.categoryActiveFieldKeys
      : Object.keys(values.categoryDynamicFields));

  const mergedEspec = mergeCategoryFieldsIntoEspecificaciones(
    existingEspecificaciones,
    values.categoryDynamicFields,
    keys,
    buildFormExtension(values),
  );

  return {
    sku: str(values.sku),
    nombre: str(values.nombre),
    asin: str(values.asin) || null,
    estado: str(values.estado) || "activo",
    proveedor_id: str(values.proveedorId) || null,
    stock_seguridad_minimo: values.stockSeguridadMinimo,
    parent_id: str(values.parentId) || null,
    heredar_precio: values.heredarPrecio,
    tax_category_id: null,
    arancel_porcentaje: values.arancelPorcentaje,
    especificaciones: mergedEspec,
  };
}

/** `producto_detalle` — solo columnas soportadas por el repositorio actual. */
export function mapProductFormToDetailPayload(
  values: ProductFormValues,
): Record<string, unknown> {
  return {
    imagen_url: str(values.imagenUrl) || null,
    categoria_id: str(values.categoriaId) || null,
    categoria: str(values.categoria) || null,
    marca: str(values.marca) || null,
    color: str(values.color) || null,
    descripcion_tecnica: str(values.descripcionTecnica) || null,
  };
}

/** `producto_logistica` — fuente de verdad operativa (medidas de caja, CBM GENERATED en BD). */
export function mapProductFormToLogisticsPayload(
  values: ProductFormValues,
): Record<string, unknown> {
  const ean = str(values.ean) || str(values.eanUpc);

  return {
    unidades_por_caja: values.unidadesPorCaja,
    pedido_minimo_unidades: values.pedidoMinimoUnidades,
    ean_upc: ean || null,
    largo_cm: positiveMeasureOrNull(values.largoCajaCm),
    ancho_cm: positiveMeasureOrNull(values.anchoCajaCm),
    alto_cm: positiveMeasureOrNull(values.altoCajaCm),
    peso_kg_bruto: positiveMeasureOrNull(values.pesoBrutoKg),
  };
}

function numOrNull(v: number): number | null {
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** `producto_finanzas` */
export function mapProductFormToFinancePayload(
  values: ProductFormValues,
): Record<string, unknown> {
  return {
    precio_venta_objetivo: values.precioVentaBase,
    tax_category_id: null,
  };
}

/** `producto_ficha_tecnica` — datos técnicos/descriptivos (sin medidas de caja operativas). */
export function mapProductFormToTechnicalSheetPayload(
  values: ProductFormValues,
): Record<string, unknown> {
  return {
    modelo: str(values.modelo) || null,
    peso_neto_kg: numOrNull(values.pesoNetoKg),
    alto_abierto_cm: numOrNull(values.altoAbiertoCm),
    ancho_abierto_cm: numOrNull(values.anchoAbiertoCm),
    fondo_abierto_cm: numOrNull(values.fondoAbiertoCm),
    alto_plegado_cm: numOrNull(values.altoPlegadoCm),
    ancho_plegado_cm: numOrNull(values.anchoPlegadoCm),
    fondo_plegado_cm: numOrNull(values.fondoPlegadoCm),
    material_estructura: str(values.materialEstructura) || null,
    material_tapizado: str(values.materialTapizado) || null,
    material_ruedas: str(values.materialRuedas) || null,
    edad_minima_aplicable: numOrNull(values.edadMinimaAplicable),
    edad_maxima_aplicable: numOrNull(values.edadMaximaAplicable),
  };
}

/** Fila manual en `producto_costos` — solo coste base; sin tipo de cambio ni EUR real. */
export function mapProductFormToManualCostPayload(
  values: ProductFormValues,
  productId: string,
): Record<string, unknown> | null {
  const monto = values.costoFabricaMonto;
  const hasCost =
    (Number.isFinite(monto) && monto > 0) || values.arancelPorcentaje > 0;

  if (!hasCost) return null;

  return {
    producto_id: productId,
    proveedor_id: str(values.proveedorId) || null,
    costo_fabrica_monto: monto > 0 ? monto : null,
    costo_fabrica_moneda: values.costoFabricaMoneda,
    costo_fabrica_eur: null,
    tipo_cambio_aplicado: null,
    arancel_porcentaje: values.arancelPorcentaje,
  };
}
