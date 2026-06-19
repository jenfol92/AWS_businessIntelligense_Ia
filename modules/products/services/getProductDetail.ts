// modules/products/services/getProductDetail.ts
//
// Carga datos de la ficha y aplica herencia padre→hijo cuando `producto.parent_id` existe.
// Precio efectivo: `getEffectiveProductPrice` (RPC + producto_precios); ver `precioEfectivo` en respuesta.

import type { ProductDetailQuery } from "../types";

import { findProductCoreById } from "../repositories/productCoreRepository";
import { findProductDetailByProductId } from "../repositories/productDetailRepository";
import { findProductLogisticsByProductId } from "../repositories/productLogisticsRepository";
import { findProductFinanceByProductId } from "../repositories/productFinanceRepository";
import {
  findProductCostsByProductId,
  findCurrentProductCost,
  findProductAverageCost,
  getProductBaseCostByProductIds,
} from "../repositories/productCostsRepository";
import { findProductDocumentsByProductId } from "../repositories/productDocumentsRepository";
import { findProductTechnicalSheetByProductId } from "../repositories/productTechnicalSheetRepository";
import {
  findProductInventoryByProductId,
  findProductStockSuggestion,
} from "../repositories/productInventoryRepository";
import {
  findProductVariants,
  findProductSiblings,
} from "../repositories/productVariantsRepository";
import { findSupplierById } from "../repositories/productSupplierRepository";
import { findProductSalesSummary } from "../repositories/productSalesRepository";
import {
  findCurrentProfitability,
  findProfitabilityByCountryAndChannel,
} from "../repositories/productProfitabilityRepository";
import { applyProductDetailInheritance } from "./applyProductInheritance";
import { mapProductDetailResponse } from "../mappers/productDetailMapper";
import { getEffectiveProductPrice } from "./getEffectiveProductPrice";

export async function getProductDetail(query: ProductDetailQuery) {
  const { productId, windowDays, pais, canal } = query;

  const productoRow = await findProductCoreById(productId);

  if (!productoRow) {
    throw new Error("Producto no encontrado");
  }

  const producto = productoRow as Record<string, unknown>;
  const parentIdRaw = producto.parent_id;
  const parentId =
    parentIdRaw != null && String(parentIdRaw).trim() !== ""
      ? String(parentIdRaw)
      : null;

  const variantParentKey =
    parentId ?? (producto.id != null ? String(producto.id) : productId);

  const coreRow = productoRow as Record<string, unknown>;
  const heredarRaw = coreRow.heredar_precio;
  const heredarPrecioForPrice =
    heredarRaw === true ? true : heredarRaw === false ? false : null;

  const mainBundlePromise = Promise.all([
    findProductDetailByProductId(productId),
    findProductLogisticsByProductId(productId),
    findProductFinanceByProductId(productId),
    findProductCostsByProductId(productId),
    findCurrentProductCost(productId),
    findProductAverageCost(productId),
    findProductDocumentsByProductId(productId),
    findProductTechnicalSheetByProductId(productId),
    findProductInventoryByProductId(productId),
    findProductStockSuggestion(productId),
    findProductVariants(variantParentKey),
    findProductSalesSummary({ productId, windowDays, pais, canal }),
    findCurrentProfitability(productId),
    findProfitabilityByCountryAndChannel({ productId, pais, canal }),
    parentId ? findProductCoreById(parentId) : Promise.resolve(null),
    parentId ? findProductDetailByProductId(parentId) : Promise.resolve(null),
    parentId ? findProductLogisticsByProductId(parentId) : Promise.resolve(null),
    parentId ? findProductTechnicalSheetByProductId(parentId) : Promise.resolve(null),
    parentId ? findProductCostsByProductId(parentId) : Promise.resolve([]),
    parentId ? findCurrentProductCost(parentId) : Promise.resolve(null),
    parentId ? findProductAverageCost(parentId) : Promise.resolve(null),
    parentId ? findProductDocumentsByProductId(parentId) : Promise.resolve([]),
  ]);

  const precioEfectivoPromise = getEffectiveProductPrice({
    productId,
    pais,
    canal,
    parentId,
    heredarPrecio: heredarPrecioForPrice,
  });

  const [
    [
      detalle,
      logistica,
      finanzas,
      costos,
      costeActual,
      costeMedio,
      documentos,
      fichaTecnica,
      inventario,
      stockSugerido,
      variantes,
      salesRows,
      rentabilidadActual,
      rentabilidadPais,
      parentCore,
      parentDetalle,
      parentLogistica,
      parentFicha,
      parentCostos,
      parentCosteActual,
      parentCosteMedio,
      parentDocumentos,
    ],
    precioEfectivo,
  ] = await Promise.all([mainBundlePromise, precioEfectivoPromise]);

  const siblings =
    parentId != null
      ? await findProductSiblings(productId, parentId)
      : [];

  const inherited = applyProductDetailInheritance({
    producto,
    parentCore: parentCore as Record<string, unknown> | null,
    detalle,
    parentDetalle,
    logistica,
    parentLogistica,
    fichaTecnica,
    parentFicha,
    costos,
    parentCostos: Array.isArray(parentCostos) ? parentCostos : [],
    costeActual,
    parentCosteActual,
    costeMedio,
    parentCosteMedio,
    documentos,
    parentDocumentos: Array.isArray(parentDocumentos) ? parentDocumentos : [],
  });

  const proveedor = await findSupplierById(inherited.proveedorIdEfectivo);

  const effectiveCostMap = await getProductBaseCostByProductIds([productId]);
  const costeBaseEfectivo = effectiveCostMap.get(productId) ?? {
    monto: null,
    moneda: null,
    source: "none" as const,
    parentProductId: parentId,
  };

  return mapProductDetailResponse({
    productId,
    windowDays,
    pais,
    canal,
    producto: inherited.producto,
    detalle: inherited.detalle,
    logistica: inherited.logistica,
    finanzas,
    proveedor,
    costos: inherited.costos,
    costeActual: inherited.costeActual,
    costeMedio: inherited.costeMedio,
    documentos: inherited.documentos,
    fichaTecnica: inherited.fichaTecnica,
    inventario,
    stockSugerido,
    parent: inherited.parent,
    variantes,
    siblings,
    salesRows,
    rentabilidadActual,
    rentabilidadPais,
    precioEfectivo,
    costeBaseEfectivo,
  });
}
