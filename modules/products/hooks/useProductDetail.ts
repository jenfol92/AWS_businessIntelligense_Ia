// modules/products/hooks/useProductDetail.ts

"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchProductDetail } from "../services/productDetailClient";

type UseProductDetailParams = {
  productId: string;
  windowDays: number;
  pais: string;
  canal: string;
};

// Este hook gestiona estado de cliente.
// La página no hace fetch directamente.
export function useProductDetail({
  productId,
  windowDays,
  pais,
  canal,
}: UseProductDetailParams) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!productId) return;

    try {
      setLoading(true);
      setError(null);

      const result = await fetchProductDetail({
        productId,
        windowDays,
        pais,
        canal,
      });

      setData(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error cargando producto";

      setError(message);
    } finally {
      setLoading(false);
    }
  }, [productId, windowDays, pais, canal]);

  useEffect(() => {
    reload();
  }, [reload]);

  return {
    data,
    loading,
    error,
    reload,
  };
}