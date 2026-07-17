// modules/products/mappers/productFormDataMapper.ts

import type { ProductFormValues, AmazonListingStatus } from "../types";
import {
  EMPTY_PRODUCT_FORM,
  EMPTY_AMAZON_SETUP,
  PRODUCT_FORM_ESPECIFICACIONES_KEY,
} from "../constants";
import {
  extractCategoryDynamicFieldsFromEspecificaciones,
} from "../utils/categoryDynamicFields";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function listingStatus(v: unknown): AmazonListingStatus {
  const s = str(v);
  if (
    s === "ready" ||
    s === "active" ||
    s === "error" ||
    s === "synced"
  )
    return s;
  return "draft";
}

function readFormExtension(
  especificaciones: unknown,
): Record<string, unknown> | null {
  const root = asRecord(especificaciones);
  if (!root) return null;
  return asRecord(root[PRODUCT_FORM_ESPECIFICACIONES_KEY]);
}

type FormLoadInput = {
  producto: unknown;
  detalle: unknown;
  logistica: unknown;
  finanzas: unknown;
  fichaTecnica: unknown;
  costo?: unknown;
  costoActual?: unknown;
};

/** Prioridad por campo: logística > ficha técnica legacy. */
function boxMeasureFromDb(
  logisticaValue: unknown,
  legacyFichaValue: unknown,
): number {
  const fromLogistica = num(logisticaValue);
  if (fromLogistica > 0) return fromLogistica;
  return num(legacyFichaValue);
}

/**
 * Medidas de caja al cargar el formulario.
 * Fuente de verdad: producto_logistica.
 * Fallback legacy: producto_ficha_tecnica (*_caja_cm, peso_bruto_kg).
 */
function mapBoxMeasuresFromDb(
  logistica: Record<string, unknown> | null,
  fichaTecnica: Record<string, unknown> | null,
): Pick<ProductFormValues, "pesoBrutoKg" | "altoCajaCm" | "anchoCajaCm" | "largoCajaCm"> {
  return {
    pesoBrutoKg: boxMeasureFromDb(
      logistica?.peso_kg_bruto,
      fichaTecnica?.peso_bruto_kg,
    ),
    altoCajaCm: boxMeasureFromDb(logistica?.alto_cm, fichaTecnica?.alto_caja_cm),
    anchoCajaCm: boxMeasureFromDb(
      logistica?.ancho_cm,
      fichaTecnica?.ancho_caja_cm,
    ),
    largoCajaCm: boxMeasureFromDb(
      logistica?.largo_cm,
      fichaTecnica?.largo_caja_cm,
    ),
  };
}

export function mapProductCostFieldsFromDb(
  producto: Record<string, unknown> | null,
  costo: Record<string, unknown> | null,
  costoActual: Record<string, unknown> | null,
): Pick<
  ProductFormValues,
  | "costoFabricaMonto"
  | "costoFabricaMoneda"
  | "tipoCambioAplicado"
  | "costoFabricaEur"
  | "arancelPorcentaje"
  | "transitoEurUnit"
  | "gastosLlegadaPuertoEurUnit"
  | "costoFleteUnitEur"
  | "costoUnitarioTotalEur"
> {
  const src = costo ?? costoActual;
  const monedaRaw = str(src?.costo_fabrica_moneda).toUpperCase();
  const moneda =
    monedaRaw === "EUR" ||
    monedaRaw === "GBP" ||
    monedaRaw === "CNY" ||
    monedaRaw === "USD"
      ? monedaRaw
      : "USD";

  return {
    costoFabricaMonto: num(src?.costo_fabrica_monto) || num(src?.costo_fabrica_eur),
    costoFabricaMoneda: moneda as ProductFormValues["costoFabricaMoneda"],
    tipoCambioAplicado: num(src?.tipo_cambio_aplicado),
    costoFabricaEur: num(src?.costo_fabrica_eur),
    arancelPorcentaje:
      num(producto?.arancel_porcentaje) || num(src?.arancel_porcentaje),
    transitoEurUnit: num(src?.transito_eur_unit ?? costoActual?.transito_eur_unit),
    gastosLlegadaPuertoEurUnit: num(
      src?.gastos_llegada_puerto_eur_unit ??
        costoActual?.gastos_llegada_puerto_eur_unit,
    ),
    costoFleteUnitEur: num(
      src?.costo_flete_unit_eur ?? costoActual?.costo_flete_unit_eur,
    ),
    costoUnitarioTotalEur: num(
      src?.costo_unitario_total_eur ?? costoActual?.costo_unitario_total_eur,
    ),
  };
}

export function mapProductFormDataToValues(input: FormLoadInput): ProductFormValues {
  const p = asRecord(input.producto);
  const d = asRecord(input.detalle);
  const l = asRecord(input.logistica);
  const f = asRecord(input.finanzas);
  const ft = asRecord(input.fichaTecnica);
  const costo = asRecord(input.costo);
  const costoActual = asRecord(input.costoActual);

  const categoriaRel = asRecord(d?.categoria);
  const categoriaId =
    str(d?.categoria_id) || str(categoriaRel?.id);
  const categoriaNombre =
    str(categoriaRel?.nombre) ||
    str(d?.categoria_nombre) ||
    str(d?.categoria);

  const categoryDynamicFields =
    extractCategoryDynamicFieldsFromEspecificaciones(p?.especificaciones);

  const ext = readFormExtension(p?.especificaciones);
  const identifiers = asRecord(ext?.identifiers) ?? {};
  const amazon = asRecord(ext?.amazon) ?? {};
  const amazonContent = asRecord(amazon.content) ?? {};
  const amazonPublication = asRecord(amazon.publication) ?? {};

  return {
    ...EMPTY_PRODUCT_FORM,

    id: str(p?.id) || undefined,
    sku: str(p?.sku),
    nombre: str(p?.nombre),
    asin: str(p?.asin),
    estado: str(p?.estado) || EMPTY_PRODUCT_FORM.estado,

    proveedorId: str(p?.proveedor_id),
    stockSeguridadMinimo: num(p?.stock_seguridad_minimo),
    parentId: str(p?.parent_id),
    heredarPrecio: bool(p?.heredar_precio, true),
    heredarCosteUnitarioTotal: bool(p?.heredar_coste_unitario_total, true),
    applyCostChangeToVariants: false,

    categoriaId,
    categoria: categoriaNombre,
    categoryDynamicFields,
    categoryActiveFieldKeys: [],
    marca: str(d?.marca),
    color: str(d?.color),
    imagenUrl: str(d?.imagen_url),
    descripcionTecnica: str(d?.descripcion_tecnica),

    modelo: str(ft?.modelo),

    ean: str(identifiers.ean) || str(l?.ean_upc),
    referenciaFabricante: str(identifiers.referencia_fabricante),
    codigoProveedor: str(identifiers.codigo_proveedor),
    eanUpc: str(l?.ean_upc),

    unidadesPorCaja: num(l?.unidades_por_caja),
    pedidoMinimoUnidades: num(l?.pedido_minimo_unidades),
    cubicajeUnitarioM3: num(l?.cubicaje_unitario_m3),

    precioVentaBase: num(f?.precio_venta_objetivo),

    priceChannel: str(ext?.price_channel) || EMPTY_PRODUCT_FORM.priceChannel,
    notasGenerales: str(ext?.notas_generales),

    ...mapProductCostFieldsFromDb(p, costo, costoActual),

    pesoNetoKg: num(ft?.peso_neto_kg),
    ...mapBoxMeasuresFromDb(l, ft),
    altoAbiertoCm: num(ft?.alto_abierto_cm),
    anchoAbiertoCm: num(ft?.ancho_abierto_cm),
    fondoAbiertoCm: num(ft?.fondo_abierto_cm),
    altoPlegadoCm: num(ft?.alto_plegado_cm),
    anchoPlegadoCm: num(ft?.ancho_plegado_cm),
    fondoPlegadoCm: num(ft?.fondo_plegado_cm),
    materialEstructura: str(ft?.material_estructura),
    materialTapizado: str(ft?.material_tapizado),
    materialRuedas: str(ft?.material_ruedas),
    edadMinimaAplicable: num(ft?.edad_minima_aplicable),
    edadMaximaAplicable: num(ft?.edad_maxima_aplicable),

    amazonTitle: str(amazonContent.title),
    amazonBrand: str(amazonContent.brand),
    amazonDescription: str(amazonContent.description),
    amazonBullet1: str(amazonContent.bullet1),
    amazonBullet2: str(amazonContent.bullet2),
    amazonBullet3: str(amazonContent.bullet3),
    amazonBullet4: str(amazonContent.bullet4),
    amazonBullet5: str(amazonContent.bullet5),
    amazonKeywords: str(amazonContent.keywords),
    amazonTargetAudience: str(amazonContent.target_audience),
    amazonSearchTerms: str(amazonContent.search_terms),
    amazonProductType: str(amazonContent.product_type),
    amazonBrowseNodeId: str(amazonContent.browse_node_id),
    amazonConditionType:
      str(amazonContent.condition_type) ||
      EMPTY_PRODUCT_FORM.amazonConditionType,
    amazonLanguage:
      str(amazonContent.language) || EMPTY_PRODUCT_FORM.amazonLanguage,
    amazonMarketplace:
      str(amazonContent.marketplace) || EMPTY_PRODUCT_FORM.amazonMarketplace,

    amazonSyncEnabled: bool(amazonPublication.sync_enabled, false),
    amazonListingStatus: listingStatus(amazonPublication.listing_status),
    amazonLastSyncAt: str(amazonPublication.last_sync_at),
    amazonListingAsin: str(amazonPublication.asin),
    amazonListingSku: str(amazonPublication.sku),

    amazonSetup: EMPTY_AMAZON_SETUP,
  };
}
