import type { PreloadedItem } from "@/modules/orders/components/OrderFormModal";
import type { ContainerOptimizationGroup } from "../types/planner.types";

/** Convierte un grupo de contenedor en ítems precargados para OrderFormModal. */
export function containerGroupToPreloadedItems(
  group: ContainerOptimizationGroup,
): PreloadedItem[] {
  return group.products.map((p) => {
    const cbmUnit =
      p.recommendedUnits > 0 ? p.cbmTotal / p.recommendedUnits : 0;
    return {
      producto_id: p.productId,
      sku: p.sku,
      nombre: p.productName,
      proveedor_id: p.supplierId,
      proveedor_nombre: p.supplierName,
      cbm_unitario: cbmUnit,
      coste_unitario_usd: null,
      unidades_sugeridas: p.recommendedUnits,
      agente_id: group.sharedAgentId ?? p.agentId ?? null,
      agente_contacto:
        group.agentContact !== "Varios agentes" && group.agentContact !== "Sin agente"
          ? group.agentContact
          : null,
      fob_puerto: group.recommendedPortName,
    };
  });
}
