// modules/products/services/applyProductInheritance.ts
//
// Orquesta reglas de herencia padre → hijo para el detalle de producto.
// Los merges en memoria están en `mappers/productInheritanceMapper.ts`.

import type { ProductDetailParent } from "../types/";
import {
  mergeCosteVista,
  mergeCostosLista,
  mergeDetalleConPadre,
  mergeDocumentosLista,
  mergeProductoEspecificaciones,
  mergeRegistroHijoPadre,
  resolveProveedorIdEfectivo,
  type ProductoCoreForInheritance,
  type ProductoDetalleRow,
} from "../mappers/productInheritanceMapper";

export type ApplyProductDetailInheritanceParams = {
  /** Fila completa `productos` del hijo (se respeta salvo `especificaciones` fusionada). */
  producto: Record<string, unknown>;
  /** Núcleo padre cargado con `findProductCoreById`; null si no hay variante. */
  parentCore: Record<string, unknown> | null;
  detalle: unknown;
  parentDetalle: unknown;
  logistica: unknown;
  parentLogistica: unknown;
  fichaTecnica: unknown;
  parentFicha: unknown;
  costos: unknown[];
  parentCostos: unknown[];
  costeActual: unknown;
  parentCosteActual: unknown;
  costeMedio: unknown;
  parentCosteMedio: unknown;
  documentos: unknown[];
  parentDocumentos: unknown[];
};

export type ApplyProductDetailInheritanceResult = {
  producto: Record<string, unknown>;
  detalle: unknown;
  logistica: unknown;
  fichaTecnica: unknown;
  costos: unknown[];
  costeActual: unknown;
  costeMedio: unknown;
  documentos: unknown[];
  proveedorIdEfectivo: string | null;
  parent: ProductDetailParent;
};

function toCoreInheritance(p: Record<string, unknown>): ProductoCoreForInheritance {
  return {
    id: String(p.id),
    proveedor_id:
      p.proveedor_id != null && String(p.proveedor_id).trim() !== ""
        ? String(p.proveedor_id)
        : null,
    parent_id:
      p.parent_id != null && String(p.parent_id).trim() !== ""
        ? String(p.parent_id)
        : null,
    especificaciones: p.especificaciones,
  };
}

function mergeEspecificacionesEnProducto(
  producto: Record<string, unknown>,
  coreMerged: ProductoCoreForInheritance
): Record<string, unknown> {
  return {
    ...producto,
    especificaciones: coreMerged.especificaciones,
  };
}

/**
 * Aplica todas las reglas de herencia útiles para la ficha (sin precio RPC).
 */
export function applyProductDetailInheritance(
  params: ApplyProductDetailInheritanceParams
): ApplyProductDetailInheritanceResult {
  const { producto, parentCore } = params;
  const hijoId = String(producto.id ?? "");

  const parent: ProductDetailParent = parentCore
    ? {
        id: String(parentCore.id),
        sku: parentCore.sku != null ? String(parentCore.sku) : null,
        nombre: parentCore.nombre != null ? String(parentCore.nombre) : null,
      }
    : null;

  if (!parentCore) {
    return {
      producto,
      detalle: params.detalle,
      logistica: params.logistica,
      fichaTecnica: params.fichaTecnica,
      costos: params.costos,
      costeActual: params.costeActual,
      costeMedio: params.costeMedio,
      documentos: params.documentos,
      proveedorIdEfectivo: resolveProveedorIdEfectivo(
        producto.proveedor_id as string | null | undefined,
        null
      ),
      parent,
    };
  }

  const hijoCore = toCoreInheritance(producto);
  const padreCore = toCoreInheritance(parentCore);
  const coreMerged = mergeProductoEspecificaciones(hijoCore, padreCore);
  const productoMerged = mergeEspecificacionesEnProducto(producto, coreMerged);

  const detalleMerged = mergeDetalleConPadre(
    params.detalle as ProductoDetalleRow | null,
    params.parentDetalle as ProductoDetalleRow | null,
    hijoId
  );

  const logisticaMerged = mergeRegistroHijoPadre(
    params.logistica as Record<string, unknown> | null,
    params.parentLogistica as Record<string, unknown> | null,
    hijoId
  );

  const fichaMerged = mergeRegistroHijoPadre(
    params.fichaTecnica as Record<string, unknown> | null,
    params.parentFicha as Record<string, unknown> | null,
    hijoId
  );

  const costosH = Array.isArray(params.costos) ? params.costos : [];
  const costosP = Array.isArray(params.parentCostos) ? params.parentCostos : [];
  const costosMerged = mergeCostosLista(costosH, costosP);

  const costeActualMerged = mergeCosteVista(
    params.costeActual,
    params.parentCosteActual
  );
  const costeMedioMerged = mergeCosteVista(
    params.costeMedio,
    params.parentCosteMedio
  );

  const docsH = Array.isArray(params.documentos) ? params.documentos : [];
  const docsP = Array.isArray(params.parentDocumentos)
    ? params.parentDocumentos
    : [];
  const documentosMerged = mergeDocumentosLista(docsH, docsP);

  const proveedorIdEfectivo = resolveProveedorIdEfectivo(
    producto.proveedor_id as string | null | undefined,
    parentCore.proveedor_id as string | null | undefined
  );

  return {
    producto: productoMerged,
    detalle: detalleMerged,
    logistica: logisticaMerged,
    fichaTecnica: fichaMerged,
    costos: costosMerged,
    costeActual: costeActualMerged,
    costeMedio: costeMedioMerged,
    documentos: documentosMerged,
    proveedorIdEfectivo,
    parent,
  };
}
