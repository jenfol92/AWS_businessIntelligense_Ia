// modules/products/types/product-detail.types.ts
//
// Contrato estable de la ficha de producto (GET /api/products/[id] → getProductDetail).
// - Top-level: nombres en camelCase donde se indica (logisticaResumen, fichaTecnica).
// - Alias temporales en snake_case solo donde la UI heredada o integraciones lo exigen.
// - Sub-bloques inventario / ventas / rentabilidad mantienen snake_case interno hasta migrar componentes.

import type { ProductBaseCost } from "../utils/resolveEffectiveBaseCost";
export type ProductDetailParent = {
  id: string;
  sku: string | null;
  nombre: string | null;
} | null;

/**
 * Hermanos del producto actual (misma fila `productos`, mismo `parent_id`).
 * Forma plana para selects y avatares en la ficha.
 */
export type ProductDetailSibling = {
  id: string;
  sku: string;
  nombre: string;
  estado: string | null;
  imagenUrl: string | null;
  color: string | null;
};

/**
 * Variante hijo (excluido el `productId` actual en el mapper cuando aplica).
 */
export type ProductDetailVariante = {
  id: string;
  sku: string;
  nombre: string;
  estado: string | null;
  heredarPrecio: boolean;
  imagenUrl: string | null;
  color: string | null;
};

/**
 * Punto de serie de ventas (una fila o agregado por fecha).
 * Claves en snake_case por compat con gráficos/KPIs actuales.
 */
export type ProductDetailVentasSeriesPoint = {
  fecha: string;
  unidades: number;
  beneficio_neto: number;
  ingresos_brutos: number;
  publicidad_gasto_ads: number;
};

/** Resumen de ventas en ventana; snake_case interno (compat UI). */
export type ProductDetailVentas = {
  unidades_total: number;
  beneficio_neto_total: number;
  ingresos_brutos_total: number;
  publicidad_gasto_ads_total: number;
  media_diaria_unidades: number;
  acos: number | null;
  series: ProductDetailVentasSeriesPoint[];
};

/** Inventario agregado + filas; snake_case interno (compat UI). */
export type ProductDetailInventario = {
  by_country: unknown[];
  stock_fba: number;
  stock_fbm: number;
  stock_total: number;
  stock_scope: number;
  riesgo: string | null;
  dias_cobertura: number | null;
  stock_seguridad_minimo: number;
  unidades_a_pedir: number;
};

/** Resumen logístico operativo; snake_case interno (compat con KPIs / cards). */
export type ProductDetailLogisticaResumenPayload = {
  lead_time_dias: number;
  buffer_dias: number;
  pedido_recomendado: number;
};

/**
 * Vista principal (camelCase) y alias temporal (snake_case) apuntan al mismo payload
 * para no duplicar objetos en runtime si se prefiere una sola referencia.
 */
export type ProductDetailLogisticaResumen = ProductDetailLogisticaResumenPayload;

/**
 * Precio de venta efectivo (RPC + fallback `producto_precios`, herencia padre/hijo).
 * Contrato estable para ficha y consumidores futuros (catálogo, motor, etc.).
 */
export type ProductEffectivePrice = {
  precioVentaBase: number | null;
  currency: string;
  source: "rpc" | "rpc_single_arg" | "producto_precios" | "none";
  inherited: boolean;
  usedFallback: boolean;
};

/** Rentabilidad para cabecera/KPIs; snake_case interno (compat UI). */
export type ProductDetailRentabilidad = {
  precio_venta_objetivo: number | null;
  coste_unitario: number | null;
  margen_bruto_porcentaje: number | null;
  raw: unknown;
};

export type ProductDetailCostRow = {
  id?: string | null;
  producto_id?: string | null;
  proveedor_id?: string | null;
  costo_fabrica_monto?: number | null;
  costo_fabrica_moneda?: string | null;
  costo_fabrica_eur?: number | null;
  tipo_cambio_aplicado?: number | null;
  arancel_porcentaje?: number | null;
  transito_eur_unit?: number | null;
  gastos_llegada_puerto_eur_unit?: number | null;
  costo_flete_unit_eur?: number | null;
  costo_unitario_total_eur?: number | null;
  pais_destino?: string | null;
  contenedor_id?: string | null;
  lote_producto?: string | null;
  fecha?: string | null;
};

export type ProductDetailAverageCost = {
  coste_medio_eur?: number | null;
  n_lotes?: number | null;
  unidades_compradas_total?: number | null;
  ultimo_lote?: string | null;
};

export type ProductDetailUnitTotalCostSource = "own" | "parent" | "none";

export type ProductDetailUnitTotalCost = {
  valueEur: number | null;
  source: ProductDetailUnitTotalCostSource;
  inheritedFromParent: boolean;
  inheritanceRequested: boolean;
  parentProductId: string | null;
};

/**
 * Archivo anidado compatible con checklist tipo ProductDocumentosCard:
 * props `registryDocs[].documento` con claves snake_case.
 */
export type ProductDetailRegistryDocumentoNested = {
  id?: string;
  nombre_archivo: string;
  drive_id: string | null;
  fecha_expiracion?: string | null;
};

/**
 * Relación producto–documento normalizada para la ficha.
 * - Mantiene el embed Supabase `documentos` (plural) para ProductDocumentsCard actual ERP.
 * - Añade `documento` (singular) como alias de compatibilidad hacia ProductDocumentosCard.
 */
export type ProductDetailDocumentoRel = {
  id: string;
  producto_id: string;
  documento_id: string;
  tipo: string;
  descripcion_extra: string | null;
  es_obligatorio_bi: boolean;
  esta_verificado: boolean;
  mercado: string | null;
  fecha_expiracion: string | null;
  documentos: {
    id: string;
    nombre_archivo: string;
    drive_id: string | null;
    fecha_expiracion: string | null;
    created_at: string | null;
  } | null;
  /** Alias singular; mismos datos que `documentos` cuando está presente. */
  documento: ProductDetailRegistryDocumentoNested | null;
};

/**
 * Respuesta canónica de la ficha de producto.
 *
 * Alias de compatibilidad (no duplicar datos: el mapper asigna la misma referencia):
 * - `ficha` → misma referencia que `fichaTecnica`
 * - `logistica_resumen` → misma referencia que `logisticaResumen`
 *
 * Campos `producto`, `detalle`, `logistica`, `finanzas`, `proveedor`, `costos`, etc. siguen
 * reflejando filas Supabase (snake_case en columnas) hasta tipar tablas al detalle.
 */
export type ProductDetailResponse = {
  ok: true;
  windowDays: number;
  pais: string;
  canal: string;

  producto: unknown;
  parent: ProductDetailParent;
  siblings: ProductDetailSibling[];
  variantes: ProductDetailVariante[];

  detalle: unknown;
  logistica: unknown;

  /** Principal (camelCase). */
  fichaTecnica: unknown;
  /**
   * Alias temporal hacia contrato antiguo (`ficha`).
   * Misma referencia que `fichaTecnica` en el mapper.
   */
  ficha: unknown;

  finanzas: unknown;
  proveedor: unknown;

  /** Histórico de costes (lista). */
  costos: ProductDetailCostRow[];
  costeActual: ProductDetailCostRow | null;
  costeMedio: ProductDetailAverageCost | null;

  documentos: ProductDetailDocumentoRel[];

  inventario: ProductDetailInventario;
  ventas: ProductDetailVentas;

  /** Principal (camelCase). */
  logisticaResumen: ProductDetailLogisticaResumen;
  /**
   * Alias temporal hacia UI que aún usa `logistica_resumen`.
   * Misma referencia que `logisticaResumen` en el mapper.
   */
  logistica_resumen: ProductDetailLogisticaResumen;

  rentabilidad: ProductDetailRentabilidad;

  /** Precio efectivo unificado (no sustituye `finanzas` ni `rentabilidad` en esta fase). */
  precioEfectivo: ProductEffectivePrice;

  /** Coste base efectivo (propio o fallback padre). */
  costeBaseEfectivo: ProductBaseCost;

  /** Coste unitario total EUR efectivo para la ficha. */
  costeUnitarioTotal: ProductDetailUnitTotalCost;

  /**
   * Fila cruda de `v_stock_seguridad_sugerido` (riesgo, días cobertura, unidades a pedir, etc.).
   * Expuesto para KPIs que lean `stockSugerido` explícito; no sustituye `inventario` agregado.
   */
  stockSugerido: unknown;
};

/** Entrada interna del mapper (sin añadir lógica SQL aquí). */
export type ProductDetailMapperInput = {
  productId: string;
  windowDays: number;
  pais: string;
  canal: string;
  producto: unknown;
  detalle: unknown;
  logistica: unknown;
  finanzas: unknown;
  proveedor: unknown;
  costos: ProductDetailCostRow[];
  costeActual: ProductDetailCostRow | null;
  costeMedio: ProductDetailAverageCost | null;
  documentos: unknown[];
  fichaTecnica: unknown;
  inventario: unknown[];
  stockSugerido: unknown;
  parent: ProductDetailParent;
  variantes: unknown[];
  siblings: unknown[];
  salesRows: unknown[];
  rentabilidadActual: unknown;
  rentabilidadPais: unknown;
  precioEfectivo: ProductEffectivePrice;
  costeBaseEfectivo: ProductBaseCost;
  costeUnitarioTotal: ProductDetailUnitTotalCost;
};
