// modules/products/services/getProductById.ts

import { getProductForm } from "./getProductForm";

/** Caso de uso: obtener valores de formulario para un producto (alias de getProductForm). */
export async function getProductById(productId: string) {
  return getProductForm(productId);
}