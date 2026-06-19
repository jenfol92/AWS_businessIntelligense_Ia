// modules/inventory/services/buildInventoryDashboard.ts
//
// Construye el listado comparativo de inventario con filtros y resumen ejecutivo.

import type {
  InventoryComparisonParams,
  InventoryComparisonResponse,
} from "../types/inventory.types";
import {
  flattenForFilter,
  groupProductsWithVariants,
  matchesSearch,
} from "./buildInventoryProduct";
import { loadInventoryContext } from "./loadInventoryContext";

export async function buildInventoryDashboard(
  params: InventoryComparisonParams = {},
): Promise<InventoryComparisonResponse> {
  const ctx = await loadInventoryContext(params.canal);
  let products = groupProductsWithVariants(ctx.products, ctx);

  const q = (params.q ?? "").trim();
  const categoria = params.categoria ?? "ALL";
  const proveedor = params.proveedor ?? "ALL";

  products = products.filter((p) => {
    const flat = [p, ...p.variantes];
    const categoryMatch =
      categoria === "ALL" ||
      flat.some((x) => x.categoria === categoria);
    const supplierMatch =
      proveedor === "ALL" ||
      flat.some((x) => x.proveedorNombre === proveedor);
    const searchMatch =
      !q || flat.some((x) => matchesSearch(x, q));
    return categoryMatch && supplierMatch && searchMatch;
  });

  if (params.soloCriticos) {
    products = products.filter((p) =>
      [p, ...p.variantes].some((x) => x.risk === "critico"),
    );
  }

  if (params.stockZero) {
    products = products.filter((p) =>
      [p, ...p.variantes].some((x) => x.stockTotal === 0),
    );
  }

  if (params.sinHistorico) {
    products = products.filter((p) =>
      [p, ...p.variantes].some((x) => !x.hasHistory),
    );
  }

  if (params.conInbound) {
    products = products.filter((p) =>
      [p, ...p.variantes].some((x) => x.hasInbound),
    );
  }

  const flatAll = flattenForFilter(products);
  const categorias = Array.from(
    new Set(flatAll.map((p) => p.categoria).filter(Boolean) as string[]),
  ).sort();
  const proveedores = Array.from(
    new Set(flatAll.map((p) => p.proveedorNombre).filter(Boolean) as string[]),
  ).sort();

  const summary = {
    totalProducts: flatAll.length,
    productsAtRisk: flatAll.filter((p) => p.risk === "critico").length,
    productsStockZero: flatAll.filter((p) => p.stockTotal === 0).length,
    productsNoHistory: flatAll.filter((p) => !p.hasHistory).length,
    productsWithInbound: flatAll.filter((p) => p.hasInbound).length,
  };

  return {
    ok: true,
    products,
    summary,
    categorias,
    proveedores,
  };
}
