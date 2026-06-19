// modules/products/types/detail.types.ts

/** Parámetros de lectura de la ficha (API + service). */
export type ProductDetailQuery = {
  productId: string;
  windowDays: number;
  pais: string;
  canal: string;
};
