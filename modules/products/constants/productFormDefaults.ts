import type { ProductFormValues } from "../types/product-form.types";
import type { ProductAmazonSetupFormValues } from "../types/product-amazon.types";
import { EMPTY_PRODUCT_INHERITANCE_OVERRIDES } from "../types/product-inheritance.types";

/** Clave única dentro de `productos.especificaciones` para campos del formulario modular. */
export const PRODUCT_FORM_ESPECIFICACIONES_KEY = "form_extensions_v1";

export const EMPTY_AMAZON_SETUP: ProductAmazonSetupFormValues = {
  assignedMarketplaceIds: [],
  contentByMarketplaceId: {},
};

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  sku: "",
  nombre: "",
  estado: "activo",
  categoriaId: "",
  categoria: "",
  categoryDynamicFields: {},
  categoryActiveFieldKeys: [],
  marca: "",
  modelo: "",
  imagenUrl: "",
  color: "",
  descripcionTecnica: "",

  ean: "",
  asin: "",
  referenciaFabricante: "",
  codigoProveedor: "",

  proveedorId: "",
  stockSeguridadMinimo: 0,
  parentId: "",
  heredarPrecio: true,
  heredarCosteUnitarioTotal: false,
  applyCostChangeToVariants: false,
  inheritanceOverrides: EMPTY_PRODUCT_INHERITANCE_OVERRIDES,

  unidadesPorCaja: 0,
  pedidoMinimoUnidades: 0,
  eanUpc: "",
  cubicajeUnitarioM3: 0,

  precioVentaBase: 0,
  priceChannel: "AMAZON_FBA",

  costoFabricaMonto: 0,
  costoFabricaMoneda: "USD",
  factoryCostsByCurrency: {},
  tipoCambioAplicado: 0,
  costoFabricaEur: 0,
  arancelPorcentaje: 0,
  transitoEurUnit: 0,
  gastosLlegadaPuertoEurUnit: 0,
  costoFleteUnitEur: 0,
  costoUnitarioTotalEur: 0,

  costeBaseEfectivoMonto: null,
  costeBaseEfectivoMoneda: null,
  costeBaseSource: "none",

  notasGenerales: "",

  pesoNetoKg: 0,
  pesoBrutoKg: 0,
  altoCajaCm: 0,
  anchoCajaCm: 0,
  largoCajaCm: 0,
  altoAbiertoCm: 0,
  anchoAbiertoCm: 0,
  fondoAbiertoCm: 0,
  altoPlegadoCm: 0,
  anchoPlegadoCm: 0,
  fondoPlegadoCm: 0,
  materialEstructura: "",
  materialTapizado: "",
  materialRuedas: "",
  edadMinimaAplicable: 0,
  edadMaximaAplicable: 0,

  amazonTitle: "",
  amazonBrand: "",
  amazonDescription: "",
  amazonBullet1: "",
  amazonBullet2: "",
  amazonBullet3: "",
  amazonBullet4: "",
  amazonBullet5: "",
  amazonKeywords: "",
  amazonTargetAudience: "",
  amazonSearchTerms: "",
  amazonProductType: "",
  amazonBrowseNodeId: "",
  amazonConditionType: "new_new",
  amazonLanguage: "es",
  amazonMarketplace: "ES",

  amazonSyncEnabled: false,
  amazonListingStatus: "draft",
  amazonLastSyncAt: "",
  amazonListingAsin: "",
  amazonListingSku: "",

  amazonSetup: EMPTY_AMAZON_SETUP,
};
