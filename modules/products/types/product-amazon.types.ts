// modules/products/types/product-amazon.types.ts
//
// Amazon: catálogo `amazon_marketplaces`, enlaces `producto_marketplaces`,
// contenido `producto_amazon_content`. Sin SP-API en esta fase.

/** Idioma de contenido (tabla `producto_amazon_content.language`). */
export type AmazonLanguageCode = "es" | "fr" | "de" | "it" | "pt" | "en";

/**
 * Estado de listado / sync (columna `producto_marketplaces.status`).
 */
export type AmazonListingStatus =
  | "draft"
  | "ready"
  | "active"
  | "synced"
  | "error";

/** Fila catálogo `amazon_marketplaces` (identificador técnico = `id`, p. ej. A1RKKUPIHCS9HS). */
export type AmazonMarketplaceCatalog = {
  id: string;
  code: string;
  name: string;
  currency: string;
  languageCode: string;
  region: string;
};

/** Fila `producto_marketplaces` (vista dominio). */
export type ProductMarketplace = {
  /** UUID fila `producto_marketplaces`. */
  rowId: string;
  productoId: string;
  /** FK `amazon_marketplaces.id`. */
  marketplaceId: string;
  listingStatus: AmazonListingStatus;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  externalAsin: string | null;
  externalSku: string | null;
};

/** Fila `producto_amazon_content` (vista dominio). */
export type ProductAmazonContent = {
  id: string;
  productoMarketplaceId: string;
  languageCode: string;
  title: string;
  brand: string;
  description: string;
  bullet1: string;
  bullet2: string;
  bullet3: string;
  bullet4: string;
  bullet5: string;
  searchTerms: string;
  keywords: string;
  productType: string;
  browseNodeId: string;
  conditionType: string;
  targetAudience: string;
  qualityScore: number | null;
  validationWarnings: AmazonContentValidationWarning[] | null;
};

/** Aviso de cumplimiento / calidad (no bloqueante). */
export type AmazonContentValidationWarning = {
  code: string;
  message: string;
};

/** Puntuación orientativa 0–100 con desglose. */
export type AmazonContentQualityScore = {
  overall: number;
  breakdown: {
    title: number;
    description: number;
    bullets: number;
    searchTerms: number;
    keywords: number;
  };
};

/**
 * Borrador por marketplace seleccionado.
 * Clave en `contentByMarketplaceId`: `amazon_marketplaces.id`.
 */
export type AmazonMarketplaceContentDraft = {
  /** Código visual opcional (`amazon_marketplaces.code`, p. ej. ES). */
  marketplaceCode?: string;
  languageCode: string;
  title: string;
  brand: string;
  description: string;
  bullet1: string;
  bullet2: string;
  bullet3: string;
  bullet4: string;
  bullet5: string;
  searchTerms: string;
  keywords: string;
  productType: string;
  browseNodeId: string;
  conditionType: string;
  targetAudience: string;
  listingStatus: AmazonListingStatus;
  syncEnabled: boolean;
  lastSyncAt: string;
  listingAsin: string;
  listingSku: string;
};

/** Asignación mult marketplace en el formulario (IDs reales de catálogo). */
export type ProductAmazonSetupFormValues = {
  /** `amazon_marketplaces.id` seleccionados. */
  assignedMarketplaceIds: string[];
  contentByMarketplaceId: Partial<
    Record<string, AmazonMarketplaceContentDraft>
  >;
};

export type ProductAmazonSetupLoadResult = {
  formValues: ProductAmazonSetupFormValues;
  marketplaces: ProductMarketplace[];
  contents: ProductAmazonContent[];
  warningsByMarketplace: Partial<
    Record<string, AmazonContentValidationWarning[]>
  >;
  qualityByMarketplace: Partial<Record<string, AmazonContentQualityScore>>;
};
