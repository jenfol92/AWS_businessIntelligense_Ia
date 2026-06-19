// modules/products/services/deleteProduct.ts

import { deleteProductCoreById } from "../repositories/productCoreRepository";

// Caso de uso: eliminar producto (fila núcleo; revisar cascadas en BD).
export async function deleteProduct(productId: string) {
  await deleteProductCoreById(productId);

  return {
    ok: true,
  };
}