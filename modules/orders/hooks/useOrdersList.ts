"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchOrders } from "@/modules/orders/api/orderClient";
import { fetchPortsCatalog } from "@/modules/logistics/api/logisticsClient";
import type { OrderListRow } from "@/modules/orders/types/orderList.types";
import type { OriginPort } from "@/modules/logistics/types/ports.types";

export type EstadoFiltro = "ALL" | "borrador" | "confirmado" | "cancelado" | "recibido";

export type UseOrdersListResult = {
  ordenes:          OrderListRow[];
  loading:          boolean;
  error:            string | null;
  originPorts:      OriginPort[];
  filterEstado:     EstadoFiltro;
  filterQ:          string;
  filterPuerto:     string;
  setFilterEstado:  (v: EstadoFiltro) => void;
  setFilterQ:       (v: string) => void;
  setFilterPuerto:  (v: string) => void;
  refresh:          () => void;
};

/**
 * Gestiona el listado de órdenes de compra con filtros y carga de puertos FOB.
 * Rellena `ordenes` automáticamente al montar y cada vez que cambia un filtro.
 * Expone `refresh()` para recargas manuales (tras guardar, confirmar, reabrir…).
 */
export function useOrdersList(): UseOrdersListResult {
  const [ordenes,      setOrdenes]      = useState<OrderListRow[]>([]);
  const [originPorts,  setOriginPorts]  = useState<OriginPort[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [filterEstado, setFilterEstado] = useState<EstadoFiltro>("ALL");
  const [filterQ,      setFilterQ]      = useState("");
  const [filterPuerto, setFilterPuerto] = useState("");

  // Puertos de origen: carga única al montar
  useEffect(() => {
    fetchPortsCatalog()
      .then(({ originPorts: ports }) => setOriginPorts(ports))
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchOrders({
        estado: filterEstado !== "ALL" ? filterEstado : undefined,
        q:      filterQ,
        puerto: filterPuerto,
        limit:  200,
      });
      setOrdenes(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, [filterEstado, filterQ, filterPuerto]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    ordenes,
    loading,
    error,
    originPorts,
    filterEstado,
    filterQ,
    filterPuerto,
    setFilterEstado,
    setFilterQ,
    setFilterPuerto,
    refresh,
  };
}
