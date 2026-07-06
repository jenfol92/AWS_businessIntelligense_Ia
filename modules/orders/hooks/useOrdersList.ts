"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchOrders } from "@/modules/orders/api/orderClient";
import type { OrderListRow } from "@/modules/orders/types/orderList.types";

export type EstadoFiltro = "ALL" | "borrador" | "confirmado" | "cancelado" | "recibido";

export type UseOrdersListResult = {
  ordenes: OrderListRow[];
  loading: boolean;
  error: string | null;
  filterEstado: EstadoFiltro;
  filterQ: string;
  filterCreatedFrom: string;
  filterCreatedTo: string;
  filterEtdFrom: string;
  filterEtdTo: string;
  filterEtaFrom: string;
  filterEtaTo: string;
  setFilterEstado: (v: EstadoFiltro) => void;
  setFilterQ: (v: string) => void;
  setFilterCreatedFrom: (v: string) => void;
  setFilterCreatedTo: (v: string) => void;
  setFilterEtdFrom: (v: string) => void;
  setFilterEtdTo: (v: string) => void;
  setFilterEtaFrom: (v: string) => void;
  setFilterEtaTo: (v: string) => void;
  refresh: () => void;
};

export function useOrdersList(): UseOrdersListResult {
  const [ordenes, setOrdenes] = useState<OrderListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterEstado, setFilterEstado] = useState<EstadoFiltro>("ALL");
  const [filterQ, setFilterQ] = useState("");
  const [filterCreatedFrom, setFilterCreatedFrom] = useState("");
  const [filterCreatedTo, setFilterCreatedTo] = useState("");
  const [filterEtdFrom, setFilterEtdFrom] = useState("");
  const [filterEtdTo, setFilterEtdTo] = useState("");
  const [filterEtaFrom, setFilterEtaFrom] = useState("");
  const [filterEtaTo, setFilterEtaTo] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchOrders({
        estado: filterEstado !== "ALL" ? filterEstado : undefined,
        q: filterQ,
        createdFrom: filterCreatedFrom,
        createdTo: filterCreatedTo,
        etdFrom: filterEtdFrom,
        etdTo: filterEtdTo,
        etaFrom: filterEtaFrom,
        etaTo: filterEtaTo,
        limit: 200,
      });
      setOrdenes(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [
    filterCreatedFrom,
    filterCreatedTo,
    filterEstado,
    filterEtaFrom,
    filterEtaTo,
    filterEtdFrom,
    filterEtdTo,
    filterQ,
  ]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    ordenes,
    loading,
    error,
    filterEstado,
    filterQ,
    filterCreatedFrom,
    filterCreatedTo,
    filterEtdFrom,
    filterEtdTo,
    filterEtaFrom,
    filterEtaTo,
    setFilterEstado,
    setFilterQ,
    setFilterCreatedFrom,
    setFilterCreatedTo,
    setFilterEtdFrom,
    setFilterEtdTo,
    setFilterEtaFrom,
    setFilterEtaTo,
    refresh,
  };
}
