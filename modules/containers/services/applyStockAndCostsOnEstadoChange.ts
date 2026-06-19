import {
  ESTADO_STOCK_ACTIVA_APLICACION,
  shouldApplyStockOnEstadoStockChange,
} from "@/modules/containers/constants/estadoContenedor";
import type { ApplyContainerStockResult } from "../types/containerStock.types";
import { applyContainerStock } from "./applyContainerStock";

/**
 * Dispara aplicación de stock al pasar estado_stock → disponible_stock (solo propio).
 * entregado logístico NO activa stock ni costes.
 */
export async function applyStockAndCostsOnEstadoChange(
  contenedorId: string,
  previousEstadoStock: string | null | undefined,
  newEstadoStock: string | null | undefined,
  tipoContenedor: string | null | undefined,
  options?: { userId?: string | null },
): Promise<ApplyContainerStockResult> {
  if (
    !shouldApplyStockOnEstadoStockChange(
      previousEstadoStock,
      newEstadoStock,
      tipoContenedor,
    )
  ) {
    return { triggered: false, applied: false };
  }

  void ESTADO_STOCK_ACTIVA_APLICACION;

  return applyContainerStock(contenedorId, {
    userId: options?.userId,
    includeCostPreview: true,
  });
}
