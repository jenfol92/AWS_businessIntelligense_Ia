// modules/products/mappers/productCatalogMapper.ts

import type { ProductCatalogItem, ProductCatalogRawRow } from "../types";

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Convierte la fila de la vista SQL en objeto cómodo para React.
 *
 * Aquí hacemos:
 * - snake_case → camelCase
 * - nulls → valores seguros
 * - nombres legibles
 */
export function mapProductCatalogRow(
  row: ProductCatalogRawRow
): ProductCatalogItem {
  return {
    id: row.producto_id,
    sku: row.sku ?? "",
    nombre: row.nombre ?? "Producto sin nombre",
    asin: row.asin,
    estado: row.estado ?? "activo",

    imagenUrl: row.imagen_url,
    categoria: row.categoria ?? "Sin categoría",
    categoriaId: row.categoria_id,
    marca: row.marca,
    color: row.color,

    proveedorId: row.proveedor_id,
    proveedorNombre: row.proveedor_nombre ?? "Sin proveedor",
    proveedorPais: row.proveedor_pais,
    puertoPreferido: row.puerto_preferido,

    agenteId: row.agente_id,
    agenteEmpresa: row.agente_empresa ?? "Sin agente" ,
    agenteContacto: row.agente_contacto ?? "Sin contacto",

    stockFba: toNumber(row.stock_fba),
    stockFbm: toNumber(row.stock_fbm),
    stockTotal: toNumber(row.stock_total),
    stockSeguridadMinimo: toNumber(row.stock_seguridad_minimo),

    precioVentaObjetivo: toNullableNumber(row.precio_venta_objetivo),
    costeTotalEstimado: toNullableNumber(row.costo_total_estimado),
    margenEstimado: toNullableNumber(row.margen_estimado),
    acos30d: toNullableNumber(row.acos_30d),

    diasCobertura: toNullableNumber(row.dias_cobertura),
    unidadesAPedir: toNullableNumber(row.unidades_a_pedir),
    riesgo: row.riesgo,
    ventasDiariasPromedio: toNullableNumber(row.avg_daily_used),

    parentId: row.parent_id,
    heredarPrecio: Boolean(row.heredar_precio),
    lastOrderedAt: row.last_ordered_at,
    updatedAt: row.updated_at,
  };
}