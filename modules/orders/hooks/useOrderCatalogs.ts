"use client";

import { useEffect, useState } from "react";
import { fetchPortsCatalog } from "@/modules/logistics/api/logisticsClient";
import { fetchPurchasingAgents } from "@/modules/orders/api/orderCatalogClient";
import type { OriginPort, DestinationPort } from "@/modules/logistics/types/ports.types";
import type { PurchasingAgent } from "@/modules/orders/api/orderCatalogClient";

export type UseOrderCatalogsResult = {
  puertosOrigen:  OriginPort[];
  puertosDestino: DestinationPort[];
  agentesCompra:  PurchasingAgent[];
};

/**
 * Carga los catálogos auxiliares del formulario de órdenes de compra:
 * puertos de origen/destino y agentes de compra.
 * Se dispara al montar y no vuelve a refrescar (datos estables durante la sesión).
 */
export function useOrderCatalogs(): UseOrderCatalogsResult {
  const [puertosOrigen,  setPuertosOrigen]  = useState<OriginPort[]>([]);
  const [puertosDestino, setPuertosDestino] = useState<DestinationPort[]>([]);
  const [agentesCompra,  setAgentesCompra]  = useState<PurchasingAgent[]>([]);

  useEffect(() => {
    fetchPortsCatalog()
      .then(({ originPorts, destinationPorts }) => {
        setPuertosOrigen(originPorts);
        setPuertosDestino(destinationPorts);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchPurchasingAgents()
      .then(setAgentesCompra)
      .catch(() => setAgentesCompra([]));
  }, []);

  return { puertosOrigen, puertosDestino, agentesCompra };
}
