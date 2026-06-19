"use client";

import type { OrderListRow } from "@/modules/orders/types/orderList.types";
import CreateContainerFromOrderModal from "@/modules/containers/components/CreateContainerFromOrderModal";

export type PedidosCreateContainerFlowProps = {
  orden: OrderListRow | null;
  onClose: () => void;
  onCreated: (contenedorId: string) => void;
};

export function PedidosCreateContainerFlow({
  orden,
  onClose,
  onCreated,
}: PedidosCreateContainerFlowProps) {
  if (!orden) return null;

  return (
    <CreateContainerFromOrderModal
      initialOrdenId={orden.id}
      initialLinkedContainer={orden.contenedor}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}
