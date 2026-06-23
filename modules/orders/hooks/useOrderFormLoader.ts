"use client";

import { useEffect, useState } from "react";
import { fetchOrderDetail } from "@/modules/orders/api/orderClient";
import { mapOrderDetailToFormState } from "@/modules/orders/utils/mapOrderDetailToFormState";
import type { OrderFormLoaderState } from "@/modules/orders/types/orderFormState.types";

export type UseOrderFormLoaderResult = {
  /** true mientras se está cargando el detalle de la orden. */
  loadingDetail: boolean;
  /** Error de carga, o null si no hubo problema. */
  errorDetail: string | null;
  /**
   * Estado mapeado listo para aplicar a los setters del formulario.
   * null mientras no se ha cargado o si orderId es null.
   */
  detailState: OrderFormLoaderState | null;
};

/**
 * Encapsula la carga del detalle de una orden para el modo edición del formulario.
 * Cuando orderId es null (nueva orden o inactivo), no hace ninguna petición.
 *
 * Uso típico en el componente:
 *   const { detailState } = useOrderFormLoader(isEdit ? initialOrden?.id : null);
 *   useEffect(() => { if (detailState) { setFob(detailState.fob); ... } }, [detailState]);
 */
export function useOrderFormLoader(
  orderId: string | null | undefined,
): UseOrderFormLoaderResult {
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorDetail,   setErrorDetail]   = useState<string | null>(null);
  const [detailState,   setDetailState]   = useState<OrderFormLoaderState | null>(null);

  useEffect(() => {
    if (!orderId) return;
    setLoadingDetail(true);
    setErrorDetail(null);
    fetchOrderDetail(orderId)
      .then((detail) => {
        if (detail) setDetailState(mapOrderDetailToFormState(detail));
      })
      .catch((err: unknown) => {
        setErrorDetail(err instanceof Error ? err.message : "Error al cargar la orden");
      })
      .finally(() => setLoadingDetail(false));
  }, [orderId]);

  return { loadingDetail, errorDetail, detailState };
}
