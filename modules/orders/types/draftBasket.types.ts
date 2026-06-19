import type { PreloadedItem } from "@/modules/orders/components/OrderFormModal";

/** Ítem en la cesta “orden en preparación” (antes de abrir el modal). */
export type DraftBasketItem = PreloadedItem & {
  capital_total?: number | null;
  cbm_total?: number | null;
  port_display?: string | null;
  agent_display?: string | null;
  supplier_display?: string | null;
};

export const CONTAINER_CBM_LIMIT = 65;
