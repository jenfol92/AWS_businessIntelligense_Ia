// modules/inventory/hooks/useInventorySalesByCountry.ts
//
// Estado del modal de ventas por país: carga el resumen por país y, al
// seleccionar un país, su detalle (precios y líneas). Cancela peticiones
// obsoletas para que una respuesta lenta no pise a una más nueva.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchInventorySalesByCountry,
  fetchInventorySalesCountryDetail,
} from "../services/inventoryDetailClient";
import type {
  InventorySalesByCountryResponse,
  InventorySalesCountryDetailResponse,
} from "../types/inventory.types";

export type SalesByCountryQuery = {
  productId: string;
  fromDate: string;
  toDate: string;
  canal?: string | null;
  pais?: string | null;
};

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function useInventorySalesByCountry(query: SalesByCountryQuery | null) {
  const [summary, setSummary] = useState<InventorySalesByCountryResponse | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [detail, setDetail] = useState<InventorySalesCountryDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const summaryAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);

  const productId = query?.productId ?? null;
  const fromDate = query?.fromDate ?? null;
  const toDate = query?.toDate ?? null;
  const canal = query?.canal ?? null;
  const pais = query?.pais ?? null;

  useEffect(() => {
    summaryAbortRef.current?.abort();
    detailAbortRef.current?.abort();
    setSelectedCountry(null);
    setDetail(null);
    setDetailError(null);

    if (!productId || !fromDate || !toDate) {
      setSummary(null);
      return;
    }

    const controller = new AbortController();
    summaryAbortRef.current = controller;
    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);

    fetchInventorySalesByCountry(productId, {
      fromDate,
      toDate,
      canal,
      pais,
      signal: controller.signal,
    })
      .then((json) => {
        if (!controller.signal.aborted) setSummary(json);
      })
      .catch((error) => {
        if (controller.signal.aborted || isAbort(error)) return;
        setSummaryError(error instanceof Error ? error.message : "Error cargando ventas.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSummaryLoading(false);
      });

    return () => controller.abort();
  }, [productId, fromDate, toDate, canal, pais]);

  const openCountry = useCallback(
    (country: string) => {
      if (!productId || !fromDate || !toDate) return;
      detailAbortRef.current?.abort();
      const controller = new AbortController();
      detailAbortRef.current = controller;

      setSelectedCountry(country);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);

      fetchInventorySalesCountryDetail(productId, country, {
        fromDate,
        toDate,
        canal,
        signal: controller.signal,
      })
        .then((json) => {
          if (!controller.signal.aborted) setDetail(json);
        })
        .catch((error) => {
          if (controller.signal.aborted || isAbort(error)) return;
          setDetailError(error instanceof Error ? error.message : "Error cargando detalle.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setDetailLoading(false);
        });
    },
    [productId, fromDate, toDate, canal],
  );

  const backToCountries = useCallback(() => {
    detailAbortRef.current?.abort();
    setSelectedCountry(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  useEffect(
    () => () => {
      summaryAbortRef.current?.abort();
      detailAbortRef.current?.abort();
    },
    [],
  );

  return {
    summary,
    summaryLoading,
    summaryError,
    selectedCountry,
    detail,
    detailLoading,
    detailError,
    openCountry,
    backToCountries,
  };
}
