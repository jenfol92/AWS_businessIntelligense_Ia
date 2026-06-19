// modules/products/mappers/amazonSetupMapper.ts
//
// Mapeo: `amazon_marketplaces`, `producto_marketplaces`, `producto_amazon_content`,
// borradores de formulario y campos legacy en `especificaciones`.

import type {
  AmazonMarketplaceCatalog,
  AmazonListingStatus,
  AmazonMarketplaceContentDraft,
  ProductAmazonContent,
  ProductAmazonSetupFormValues,
  ProductMarketplace,
  AmazonContentValidationWarning,
} from "../types/product-amazon.types";
import type { ProductFormValues } from "../types/product-form.types";
import { createDefaultAmazonMarketplaceDraft } from "../constants/amazonMarketplaceDefaults";

export function parseAmazonListingStatus(raw: string): AmazonListingStatus {
  if (
    raw === "ready" ||
    raw === "active" ||
    raw === "synced" ||
    raw === "error"
  )
    return raw;
  return "draft";
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function parseWarningsJson(
  raw: unknown,
): AmazonContentValidationWarning[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return null;
  const out: AmazonContentValidationWarning[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const code = str(rec.code);
    const message = str(rec.message);
    if (code && message) out.push({ code, message });
  }
  return out.length ? out : null;
}

export function mapAmazonMarketplaceCatalogRow(
  row: Record<string, unknown>,
): AmazonMarketplaceCatalog | null {
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    code: str(row.code),
    name: str(row.name),
    currency: str(row.currency),
    languageCode: str(row.language_code),
    region: str(row.region),
  };
}

export function mapProductMarketplaceRow(
  row: Record<string, unknown>,
): ProductMarketplace | null {
  const rowId = str(row.id);
  const marketplaceId = str(row.marketplace_id);
  const productoId = str(row.producto_id);
  if (!rowId || !marketplaceId || !productoId) return null;
  return {
    rowId,
    productoId,
    marketplaceId,
    listingStatus: parseAmazonListingStatus(str(row.status)),
    syncEnabled: bool(row.sync_enabled, false),
    lastSyncAt: row.last_sync_at == null ? null : String(row.last_sync_at),
    lastSyncError: str(row.last_sync_error) || null,
    externalAsin: str(row.external_asin) || null,
    externalSku: str(row.external_sku) || null,
  };
}

export function mapProductAmazonContentRow(
  row: Record<string, unknown>,
): ProductAmazonContent | null {
  const id = str(row.id);
  const pmId = str(row.producto_marketplace_id);
  if (!id || !pmId) return null;
  return {
    id,
    productoMarketplaceId: pmId,
    languageCode: str(row.language),
    title: str(row.title),
    brand: str(row.brand),
    description: str(row.description),
    bullet1: str(row.bullet_1),
    bullet2: str(row.bullet_2),
    bullet3: str(row.bullet_3),
    bullet4: str(row.bullet_4),
    bullet5: str(row.bullet_5),
    searchTerms: str(row.search_terms),
    keywords: str(row.keywords),
    productType: str(row.product_type),
    browseNodeId: str(row.browse_node_id),
    conditionType: str(row.condition_type),
    targetAudience: str(row.target_audience),
    qualityScore: num(row.quality_score),
    validationWarnings: parseWarningsJson(row.validation_warnings),
  };
}

export function mergeAmazonRowsToFormSetup(
  marketplaces: ProductMarketplace[],
  contents: ProductAmazonContent[],
  catalogByMarketplaceId: Map<string, AmazonMarketplaceCatalog>,
): ProductAmazonSetupFormValues {
  const assignedMarketplaceIds = Array.from(
    new Set(marketplaces.map((m) => m.marketplaceId)),
  ).sort();

  const contentByMarketplaceId: ProductAmazonSetupFormValues["contentByMarketplaceId"] =
    {};

  for (const pm of marketplaces) {
    const catalog = catalogByMarketplaceId.get(pm.marketplaceId);
    const defaultLang = catalog?.languageCode ?? "es";
    const withContent =
      contents.find(
        (c) =>
          c.productoMarketplaceId === pm.rowId &&
          c.languageCode === defaultLang,
      ) ?? contents.find((c) => c.productoMarketplaceId === pm.rowId);

    const base = createDefaultAmazonMarketplaceDraft(defaultLang);
    base.marketplaceCode = catalog?.code;

    const draft: AmazonMarketplaceContentDraft = withContent
      ? {
          ...base,
          languageCode: withContent.languageCode,
          title: withContent.title,
          brand: withContent.brand,
          description: withContent.description,
          bullet1: withContent.bullet1,
          bullet2: withContent.bullet2,
          bullet3: withContent.bullet3,
          bullet4: withContent.bullet4,
          bullet5: withContent.bullet5,
          searchTerms: withContent.searchTerms,
          keywords: withContent.keywords,
          productType: withContent.productType,
          browseNodeId: withContent.browseNodeId,
          conditionType: withContent.conditionType || base.conditionType,
          targetAudience: withContent.targetAudience,
          listingStatus: pm.listingStatus,
          syncEnabled: pm.syncEnabled,
          lastSyncAt: pm.lastSyncAt ?? "",
          listingAsin: pm.externalAsin ?? "",
          listingSku: pm.externalSku ?? "",
          marketplaceCode: catalog?.code ?? base.marketplaceCode,
        }
      : {
          ...base,
          listingStatus: pm.listingStatus,
          syncEnabled: pm.syncEnabled,
          lastSyncAt: pm.lastSyncAt ?? "",
          listingAsin: pm.externalAsin ?? "",
          listingSku: pm.externalSku ?? "",
          marketplaceCode: catalog?.code ?? base.marketplaceCode,
        };

    contentByMarketplaceId[pm.marketplaceId] = draft;
  }

  return { assignedMarketplaceIds, contentByMarketplaceId };
}

export function pickPrimaryMarketplaceDraft(
  setup: ProductAmazonSetupFormValues,
): { marketplaceId: string; draft: AmazonMarketplaceContentDraft } | null {
  const sorted = [...setup.assignedMarketplaceIds].sort();
  for (const marketplaceId of sorted) {
    const draft =
      setup.contentByMarketplaceId[marketplaceId] ??
      createDefaultAmazonMarketplaceDraft("es");
    return { marketplaceId, draft };
  }
  return null;
}

/** Copia el marketplace primario al modelo plano del formulario (compatibilidad JSON). */
export function applyPrimaryAmazonDraftToFlatFields(
  values: ProductFormValues,
): ProductFormValues {
  const primary = pickPrimaryMarketplaceDraft(values.amazonSetup);
  if (!primary) return values;
  const d = primary.draft;
  return {
    ...values,
    amazonTitle: d.title,
    amazonBrand: d.brand,
    amazonDescription: d.description,
    amazonBullet1: d.bullet1,
    amazonBullet2: d.bullet2,
    amazonBullet3: d.bullet3,
    amazonBullet4: d.bullet4,
    amazonBullet5: d.bullet5,
    amazonKeywords: d.keywords,
    amazonTargetAudience: d.targetAudience,
    amazonSearchTerms: d.searchTerms,
    amazonProductType: d.productType,
    amazonBrowseNodeId: d.browseNodeId,
    amazonConditionType: d.conditionType,
    amazonLanguage: d.languageCode,
    amazonMarketplace: d.marketplaceCode ?? values.amazonMarketplace,
    amazonSyncEnabled: d.syncEnabled,
    amazonListingStatus: d.listingStatus,
    amazonLastSyncAt: d.lastSyncAt,
    amazonListingAsin: d.listingAsin,
    amazonListingSku: d.listingSku,
  };
}

export function draftToMarketplaceUpsertRow(
  productoId: string,
  marketplaceId: string,
  draft: AmazonMarketplaceContentDraft,
): Record<string, unknown> {
  return {
    producto_id: productoId,
    marketplace_id: marketplaceId,
    status: draft.listingStatus,
    sync_enabled: draft.syncEnabled,
    external_sku: draft.listingSku.trim() || null,
    external_asin: draft.listingAsin.trim() || null,
    last_sync_at: draft.lastSyncAt.trim() || null,
  };
}

export function draftToContentUpsertRow(
  productoMarketplaceId: string,
  draft: AmazonMarketplaceContentDraft,
  qualityScore: number,
  validationWarnings: AmazonContentValidationWarning[],
): Record<string, unknown> {
  return {
    producto_marketplace_id: productoMarketplaceId,
    language: draft.languageCode,
    title: draft.title,
    brand: draft.brand,
    description: draft.description,
    bullet_1: draft.bullet1,
    bullet_2: draft.bullet2,
    bullet_3: draft.bullet3,
    bullet_4: draft.bullet4,
    bullet_5: draft.bullet5,
    search_terms: draft.searchTerms,
    keywords: draft.keywords,
    product_type: draft.productType,
    browse_node_id: draft.browseNodeId,
    condition_type: draft.conditionType,
    target_audience: draft.targetAudience,
    quality_score: qualityScore,
    validation_warnings: validationWarnings,
  };
}
