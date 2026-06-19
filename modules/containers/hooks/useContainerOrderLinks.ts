"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  linkOrderToContainer,
  unlinkContainerOrder,
} from "@/modules/containers/api/containerClient";
import type { OrdenDetalle } from "@/modules/containers/types/containerUiTypes";
import {
  fetchConfirmedOrders,
  type ConfirmedOrderSummary,
} from "@/modules/orders/api/orderClient";

export function useContainerOrderLinks(contenedorId: string, linkedOrders: OrdenDetalle[]) {
  const [availableOrders, setAvailableOrders] = useState<ConfirmedOrderSummary[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [linking, setLinking] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const linkedOrderIds = useMemo(
    () => new Set(linkedOrders.map((order) => order.id)),
    [linkedOrders],
  );

  const loadAvailableOrders = useCallback(async () => {
    setLoadingOrders(true);
    setError(null);
    try {
      const rows = await fetchConfirmedOrders();
      setAvailableOrders(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error cargando órdenes confirmadas");
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    void loadAvailableOrders();
  }, [loadAvailableOrders]);

  const selectableOrders = useMemo(
    () => availableOrders.filter(
      (order) => !linkedOrderIds.has(order.id) && !order.contenedor,
    ),
    [availableOrders, linkedOrderIds],
  );

  const linkOrder = useCallback(async (): Promise<boolean> => {
    if (!selectedOrderId) {
      setError("Selecciona una orden confirmada.");
      return false;
    }
    setLinking(true);
    setError(null);
    try {
      await linkOrderToContainer(contenedorId, selectedOrderId);
      setSelectedOrderId("");
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al vincular orden");
      return false;
    } finally {
      setLinking(false);
    }
  }, [contenedorId, selectedOrderId]);

  const unlinkOrder = useCallback(async (ordenId: string): Promise<boolean> => {
    setUnlinkingId(ordenId);
    setError(null);
    try {
      await unlinkContainerOrder(contenedorId, ordenId);
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error al desvincular orden");
      return false;
    } finally {
      setUnlinkingId(null);
    }
  }, [contenedorId]);

  return {
    selectableOrders,
    loadingOrders,
    selectedOrderId,
    setSelectedOrderId,
    linking,
    unlinkingId,
    error,
    setError,
    linkOrder,
    unlinkOrder,
    reloadAvailableOrders: loadAvailableOrders,
  };
}
