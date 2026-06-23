/**
 * Tipos relacionados con la búsqueda de productos para añadir a órdenes de compra.
 * Coinciden con la respuesta de GET /api/orders/products-search.
 */

export type ProductoSearch = {
  producto_id: string;
  sku: string;
  nombre: string;
  imagen_url: string | null;
  categoria: string | null;
  proveedor_id: string | null;
  proveedor_nombre: string | null;
  puerto_preferido: string | null;
  stock_fba: number;
  stock_fbm: number;
  stock_total: number;
  dias_cobertura: number | null;
  cbm_unitario: number;
  coste_unitario_moneda: number | null;
  moneda_producto: string | null;
  coste_fabrica_eur?: number | null;
  sin_coste_historico?: boolean;
  coste_unitario_usd: number | null;
};
