// modules/products/types/product-form.types.ts
//
// Contrato del formulario de producto (crear/editar).
// Campos extendidos: ERP interno, contenido Amazon (sin IA), publicación futura.

import type {
  AmazonListingStatus,
  ProductAmazonSetupFormValues,
} from "./product-amazon.types";
import type { CategoryCamposConfig } from "@/modules/categories/types/category.types";

export type { AmazonListingStatus, ProductAmazonSetupFormValues };

export type ProductFormMode = "create" | "edit";

/** Pestañas del formulario de producto. */
export type ProductFormTab =
  | "general"
  | "detalle"
  | "costes"
  | "documentacion"
  | "variantes"
  | "amazon"
  | "benchmarking";

export type ProductCostCurrency = "USD" | "EUR" | "GBP" | "CNY";

/** Documento vinculado al producto (listado en formulario). */
export type ProductFormDocumentRow = {
  relId: string;
  documentoId: string;
  tipo: string | null;
  nombreArchivo: string | null;
  driveId: string;
  fechaExpiracion: string | null;
  descripcionExtra: string | null;
  estaVerificado: boolean;
  createdAt: string | null;
};

/** Valores editables del formulario (camelCase). */
export type ProductFormValues = {
  id?: string;

  // —— Datos generales
  sku: string;
  nombre: string;
  estado: string;
  /** UUID en `producto_detalle.categoria_id`. */
  categoriaId: string;
  /** Nombre legible (denormalizado en `producto_detalle.categoria`). */
  categoria: string;
  /** Valores de `campos_config` guardados en `productos.especificaciones`. */
  categoryDynamicFields: Record<string, ProductFormFieldValue>;
  /** Claves activas según `campos_config` de la categoría seleccionada. */
  categoryActiveFieldKeys: string[];
  marca: string;
  modelo: string;
  imagenUrl: string;
  color: string;
  descripcionTecnica: string;

  // —— Identificadores
  ean: string;
  asin: string;
  referenciaFabricante: string;
  codigoProveedor: string;

  // —— Núcleo producto
  proveedorId: string;
  stockSeguridadMinimo: number;
  parentId: string;
  heredarPrecio: boolean;

  // —— Logística comercial (`producto_logistica`)
  unidadesPorCaja: number;
  pedidoMinimoUnidades: number;
  eanUpc: string;
  /** Solo lectura: `producto_logistica.cubicaje_unitario_m3` (GENERATED en BD). */
  cubicajeUnitarioM3: number;

  // —— Precio / finanzas
  /** Objetivo de venta (tabla producto_finanzas.precio_venta_objetivo). */
  precioVentaBase: number;
  /** Canal lógico (p. ej. AMAZON_FBA); guardado en `especificaciones`. */
  priceChannel: string;

  // —— Costes (`producto_costos` + `productos.arancel_porcentaje`)
  costoFabricaMonto: number;
  costoFabricaMoneda: ProductCostCurrency;
  /** Legacy: solo lectura en formulario; el TC real vive en orden/lote. */
  tipoCambioAplicado: number;
  /** Cargado desde producto_costos histórico; no se calcula en formulario. */
  costoFabricaEur: number;
  arancelPorcentaje: number;
  /** Solo lectura: vienen de facturación de contenedor. */
  transitoEurUnit: number;
  gastosLlegadaPuertoEurUnit: number;
  costoFleteUnitEur: number;
  costoUnitarioTotalEur: number;

  /** Solo lectura: coste base efectivo (propio o fallback padre). */
  costeBaseEfectivoMonto: number | null;
  costeBaseEfectivoMoneda: ProductCostCurrency | null;
  costeBaseSource: "own" | "parent" | "none";

  /** Notas internas (JSON `form_extensions_v1.notas_generales`). */
  notasGenerales: string;

  // —— Ficha técnica (`producto_ficha_tecnica`, descriptivo)
  pesoNetoKg: number;
  /**
   * UI: "Peso bruto (kg)" / medidas de caja en sección Materiales.
   * Persistencia: `producto_logistica.peso_kg_bruto`, `largo_cm`, `ancho_cm`, `alto_cm`.
   * Fallback lectura legacy: `producto_ficha_tecnica.peso_bruto_kg`, `*_caja_cm`.
   */
  pesoBrutoKg: number;
  altoCajaCm: number;
  anchoCajaCm: number;
  largoCajaCm: number;
  altoAbiertoCm: number;
  anchoAbiertoCm: number;
  fondoAbiertoCm: number;
  altoPlegadoCm: number;
  anchoPlegadoCm: number;
  fondoPlegadoCm: number;
  materialEstructura: string;
  materialTapizado: string;
  materialRuedas: string;
  edadMinimaAplicable: number;
  edadMaximaAplicable: number;

  // —— Contenido comercial Amazon (edición manual; validación por avisos)
  amazonTitle: string;
  amazonBrand: string;
  amazonDescription: string;
  amazonBullet1: string;
  amazonBullet2: string;
  amazonBullet3: string;
  amazonBullet4: string;
  amazonBullet5: string;
  amazonKeywords: string;
  amazonTargetAudience: string;
  amazonSearchTerms: string;
  amazonProductType: string;
  amazonBrowseNodeId: string;
  amazonConditionType: string;
  amazonLanguage: string;
  amazonMarketplace: string;

  // —— Publicación Amazon (futuro SP-API)
  amazonSyncEnabled: boolean;
  amazonListingStatus: AmazonListingStatus;
  /** ISO 8601 string o vacío si nunca sincronizado */
  amazonLastSyncAt: string;
  amazonListingAsin: string;
  amazonListingSku: string;

  /** Marketplaces Amazon y contenido por marketplace (tablas `producto_*`). */
  amazonSetup: ProductAmazonSetupFormValues;
};

export type ProductFormErrors = Partial<
  Record<keyof ProductFormValues, string>
> & {
  /** Errores por clave de campo dinámico de categoría. */
  dynamicFields?: Record<string, string>;
};

/** Tipos de control soportados por `ProductFieldRenderer`. */
export type ProductFormFieldType =
  | "text"
  | "number"
  | "textarea"
  | "select"
  | "multi-select"
  | "boolean";

/** Valor admitido por campo dinámico del formulario de producto. */
export type ProductFormFieldValue =
  | string
  | number
  | boolean
  | string[]
  | null;

export type ProductFormFieldValidation = {
  pattern?: string;
  min?: number;
  max?: number;
  maxLength?: number;
};

/** Datos logísticos del proveedor (solo lectura en formulario). */
export type ProductSupplierLogisticsInfo = {
  diasProduccionEstandar: number | null;
  diasTransitoEstandar: number | null;
  puertoPreferidoNombre: string | null;
  agenteContacto: string | null;
};

/** Opción para el desplegable de proveedores (`proveedores`). */
export type ProductSupplierOption = {
  id: string;
  nombre: string;
  pais: string | null;
  diasProduccionEstandar?: number | null;
  diasTransitoEstandar?: number | null;
  puertoPreferidoNombre?: string | null;
  agenteContacto?: string | null;
};

/** Opción para el desplegable de categoría (`categorias`). */
export type ProductCategoryOption = {
  id: string;
  nombre: string;
  descripcion?: string | null;
  slug?: string | null;
  campos_config: CategoryCamposConfig | null;
};

export type ProductFormFieldConfig = {
  key: string;
  label: string;
  type: ProductFormFieldType;
  required?: boolean;
  unit?: string;
  placeholder?: string;
  options?: string[];
  /** Texto orientativo para ayuda contextual / futura IA (no ejecuta llamadas). */
  aiHelp?: string;
  helpText?: string;
  validation?: ProductFormFieldValidation;
};
