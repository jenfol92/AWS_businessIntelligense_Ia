// modules/products/services/getProductCatalogOptions.ts

import { findProductCatalogFilterOptions } from "../repositories/productCatalogOptionsRepository";
import type { ProductCatalogOptionsResponse } from "../types";

export async function getProductCatalogOptions(): Promise<ProductCatalogOptionsResponse> {
  const options = await findProductCatalogFilterOptions();

  return {
    ok: true,
    options,
  };
}