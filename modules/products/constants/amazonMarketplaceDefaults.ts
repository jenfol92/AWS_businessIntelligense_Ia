import type { AmazonMarketplaceContentDraft } from "../types/product-amazon.types";

/** Borrador vacío para un marketplace; `languageCode` suele venir de `amazon_marketplaces.language_code`. */
export function createDefaultAmazonMarketplaceDraft(
  languageCode: string,
): AmazonMarketplaceContentDraft {
  const lang = languageCode.trim() || "es";
  return {
    marketplaceCode: undefined,
    languageCode: lang,
    title: "",
    brand: "",
    description: "",
    bullet1: "",
    bullet2: "",
    bullet3: "",
    bullet4: "",
    bullet5: "",
    searchTerms: "",
    keywords: "",
    productType: "",
    browseNodeId: "",
    conditionType: "new_new",
    targetAudience: "",
    listingStatus: "draft",
    syncEnabled: false,
    lastSyncAt: "",
    listingAsin: "",
    listingSku: "",
  };
}
