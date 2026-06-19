// modules/products/services/getProductAmazonSetup.ts

import { findAmazonMarketplaces } from "../repositories/amazonMarketplacesRepository";
import { findProductMarketplaces } from "../repositories/productMarketplacesRepository";
import { findAmazonContentsByProductoMarketplaceIds } from "../repositories/productAmazonContentRepository";
import {
  mapAmazonMarketplaceCatalogRow,
  mapProductAmazonContentRow,
  mapProductMarketplaceRow,
  mergeAmazonRowsToFormSetup,
} from "../mappers/amazonSetupMapper";
import {
  calculateAmazonContentQualityScore,
  validateAmazonMarketplaceDraft,
} from "../validators/amazonContentValidator";
import type {
  AmazonMarketplaceCatalog,
  ProductAmazonSetupLoadResult,
} from "../types/product-amazon.types";

export async function getProductAmazonSetup(
  productId: string,
): Promise<ProductAmazonSetupLoadResult> {
  const catalogRows = await findAmazonMarketplaces();
  const catalogEntries = catalogRows
    .map(mapAmazonMarketplaceCatalogRow)
    .filter((c): c is AmazonMarketplaceCatalog => c != null);
  const catalogById = new Map(
    catalogEntries.map((c) => [c.id, c] as const),
  );

  const rawMp = await findProductMarketplaces(productId);
  const marketplaces = rawMp
    .map(mapProductMarketplaceRow)
    .filter((m): m is NonNullable<typeof m> => m != null);

  const pmRowIds = marketplaces.map((m) => m.rowId);
  const rawContent = await findAmazonContentsByProductoMarketplaceIds(
    pmRowIds,
  );
  const contents = rawContent
    .map(mapProductAmazonContentRow)
    .filter((c): c is NonNullable<typeof c> => c != null);

  const formValues = mergeAmazonRowsToFormSetup(
    marketplaces,
    contents,
    catalogById,
  );

  const warningsByMarketplace: ProductAmazonSetupLoadResult["warningsByMarketplace"] =
    {};
  const qualityByMarketplace: ProductAmazonSetupLoadResult["qualityByMarketplace"] =
    {};

  for (const marketplaceId of formValues.assignedMarketplaceIds) {
    const draft = formValues.contentByMarketplaceId[marketplaceId];
    if (!draft) continue;
    const w = validateAmazonMarketplaceDraft(draft);
    warningsByMarketplace[marketplaceId] = w;
    qualityByMarketplace[marketplaceId] =
      calculateAmazonContentQualityScore(w);
  }

  return {
    formValues,
    marketplaces,
    contents,
    warningsByMarketplace,
    qualityByMarketplace,
  };
}
