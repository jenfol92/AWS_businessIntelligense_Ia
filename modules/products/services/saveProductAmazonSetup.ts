// modules/products/services/saveProductAmazonSetup.ts

import {
  deleteProductMarketplaceByProductAndMarketplace,
  findProductMarketplaces,
  upsertProductMarketplace,
} from "../repositories/productMarketplacesRepository";
import { upsertAmazonContent } from "../repositories/productAmazonContentRepository";
import {
  draftToContentUpsertRow,
  draftToMarketplaceUpsertRow,
} from "../mappers/amazonSetupMapper";
import { createDefaultAmazonMarketplaceDraft } from "../constants/amazonMarketplaceDefaults";
import {
  calculateAmazonContentQualityScore,
  validateAmazonMarketplaceDraft,
} from "../validators/amazonContentValidator";
import type { ProductAmazonSetupFormValues } from "../types/product-amazon.types";

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Persiste `producto_marketplaces` y `producto_amazon_content`.
 * Score y warnings solo en `producto_amazon_content`.
 * Quitar asignación borra la fila en `producto_marketplaces` (cascade al contenido).
 */
export async function saveProductAmazonSetup(
  productId: string,
  setup: ProductAmazonSetupFormValues,
): Promise<void> {
  const existing = await findProductMarketplaces(productId);
  const assigned = new Set(setup.assignedMarketplaceIds);

  for (const row of existing) {
    const mid = str(row.marketplace_id);
    if (!mid || assigned.has(mid)) continue;
    await deleteProductMarketplaceByProductAndMarketplace(productId, mid);
  }

  for (const marketplaceId of setup.assignedMarketplaceIds) {
    const draft =
      setup.contentByMarketplaceId[marketplaceId] ??
      createDefaultAmazonMarketplaceDraft("es");
    const warnings = validateAmazonMarketplaceDraft(draft);
    const score = calculateAmazonContentQualityScore(warnings);

    const { id: pmRowId } = await upsertProductMarketplace(
      draftToMarketplaceUpsertRow(productId, marketplaceId, draft),
    );

    await upsertAmazonContent(
      draftToContentUpsertRow(
        pmRowId,
        draft,
        Math.round(score.overall),
        warnings,
      ),
    );
  }
}
