// modules/products/constants.ts

/**
 * Estados internos del producto en el ERP.
 */
export const PRODUCT_STATUSES = [
    "draft",
    "development",
    "testing",
    "pending",
    "active",
    "paused",
    "discontinued",
  ] as const;
  
  /**
   * Canales de venta.
   */
  export const PRODUCT_CHANNELS = [
    "AMAZON_FBA",
    "AMAZON_FBM",
    "SHOPIFY",
    "WHOLESALE",
  ] as const;
  
  /**
   * Idiomas soportados para contenido comercial.
   */
  export const AMAZON_LANGUAGES = [
    "es",
    "en",
    "de",
    "fr",
    "it",
    "pt",
  ] as const;

  /**
   * Estado de listado / sincronización en Seller Central / ERP.
   */
  export const AMAZON_LISTING_STATUSES = [
    "draft",
    "ready",
    "active",
    "synced",
    "error",
  ] as const;
  
  /**
   * Condición del producto para Amazon.
   */
  export const AMAZON_CONDITION_TYPES = [
    "new_new",
    "used_like_new",
    "used_very_good",
    "used_good",
    "used_acceptable",
    "refurbished",
  ] as const;
  
  /**
   * Audiencia objetivo.
   */
  export const AMAZON_TARGET_AUDIENCES = [
    "adults",
    "children",
    "toddlers",
    "babies",
    "unisex",
  ] as const;
  
  /**
   * Expresiones literales que suelen indicar contacto / URL en texto libre.
   */
  export const AMAZON_PROHIBITED_PATTERNS = [
    "http://",
    "https://",
    "www.",
    "@",
    ".com",
    ".es",
    ".net",
  ] as const;

  /**
   * Tipos de producto iniciales (catálogo interno; no Listing API en esta fase).
   */
  export const AMAZON_PRODUCT_TYPES = [
    "SPORTING_GOODS",
    "TOYS_AND_GAMES",
    "HOME",
    "KITCHEN",
    "PET_SUPPLIES",
    "BABY_PRODUCTS",
    "OFFICE_PRODUCTS",
    "TOOLS",
    "HOME_AND_GARDEN",
    "ELECTRONICS",
  ] as const;
  
  /**
   * Tipos de condición internos.
   */
  export const PRODUCT_CONDITIONS = [
    "new",
    "refurbished",
    "used",
  ] as const;
  
  /**
   * Monedas soportadas.
   */
  export const SUPPORTED_CURRENCIES = [
    "EUR",
    "USD",
    "GBP",
  ] as const;
  
  /**
   * Valores por defecto del formulario.
   */
  export const DEFAULT_PRODUCT_FORM_VALUES = {
    estado: "draft",
    channel: "AMAZON_FBA",
    amazon_language: "es",
    amazon_marketplace: "ES",
    amazon_listing_status: "draft",
    amazon_condition_type: "new_new",
    amazon_sync_enabled: false,
    heredar_precio: true,
  } as const;
  
  /**
   * Claims promocionales que Amazon desaconseja.
   */
  export const AMAZON_RESTRICTED_CLAIMS = [
    "el mejor",
    "nº1",
    "numero 1",
    "garantizado",
    "100% seguro",
    "gratis",
    "oferta",
    "descuento",
    "compra ahora",
    "best seller",
    "top rated",
    "guaranteed",
  ] as const;
  
  /**
   * Patrones de teléfono (avisos estilo Seller Central).
   */
  export const AMAZON_PHONE_PATTERN =
    /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3}[-.\s]?\d{3,4}\b/g;

  /**
   * Patrón URL visible (http/s o www).
   */
  export const AMAZON_URL_PATTERN = /\b(?:https?:\/\/|www\.)\S+/i;

  /**
   * Patrón email simple.
   */
  export const AMAZON_EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i;
  
  /**
   * Límites orientativos para contenido Amazon.
   */
  export const AMAZON_CONTENT_LIMITS = {
    titleMaxLength: 200,
    descriptionMaxLength: 2000,
    bulletMaxLength: 500,
    searchTermsMaxLength: 249,
    minimumBulletsRecommended: 3,
    maximumBullets: 5,
  } as const;

  /** Límite por defecto en listados de catálogo (paginación). */
  export const PRODUCT_CATALOG_DEFAULT_LIMIT = 50;

  export {
    EMPTY_PRODUCT_FORM,
    EMPTY_AMAZON_SETUP,
    PRODUCT_FORM_ESPECIFICACIONES_KEY,
  } from "./constants/productFormDefaults";