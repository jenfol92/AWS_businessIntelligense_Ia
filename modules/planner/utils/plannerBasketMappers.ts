import type { DraftBasketItem } from "@/modules/orders/types/draftBasket.types";
import type { ContainerOptimizationGroup } from "../types/planner.types";

export type PlannerLineForBasket = {
  productId: string;
  sku: string;
  productName?: string;
  recommendedOrderUnits: number;
  cbmTotal: number | null;
  purchaseCapitalRequired: number | null;
  supplierId?: string | null;
  supplierName?: string | null;
  supplierPreferredPortName: string;
  displayPortName?: string;
  agentId?: string | null;
  agentContact: string;
  recommendationReasonLabel: string;
};

export function plannerLineToBasketItem(line: PlannerLineForBasket): DraftBasketItem {
  const units = line.recommendedOrderUnits;
  const cbm = line.cbmTotal ?? 0;
  const cbmUnit = units > 0 ? cbm / units : 0;
  const port =
    line.supplierPreferredPortName &&
    line.supplierPreferredPortName !== "Puerto sin definir" &&
    line.supplierPreferredPortName !== "Puerto pendiente"
      ? line.supplierPreferredPortName
      : null;

  return {
    producto_id: line.productId,
    sku: line.sku,
    nombre: line.productName ?? line.sku,
    proveedor_id: line.supplierId ?? null,
    proveedor_nombre: line.supplierName ?? null,
    cbm_unitario: cbmUnit,
    coste_unitario_usd: null,
    unidades_sugeridas: units,
    agente_id: line.agentId ?? null,
    agente_contacto:
      line.agentContact !== "Sin agente" && line.agentContact !== "Varios agentes"
        ? line.agentContact
        : null,
    fob_puerto: port,
    capital_total: line.purchaseCapitalRequired,
    cbm_total: cbm,
    port_display: line.supplierPreferredPortName,
    agent_display: line.agentContact,
    supplier_display: line.supplierName ?? null,
  };
}

export function containerGroupToBasketItems(
  group: ContainerOptimizationGroup,
): DraftBasketItem[] {
  return group.products.map((p) => {
    const cbmUnit = p.recommendedUnits > 0 ? p.cbmTotal / p.recommendedUnits : 0;
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
      fob_puerto:
        group.recommendedPortName !== "Puerto a revisar"
          ? group.recommendedPortName
          : null,
      cbm_total: p.cbmTotal,
      port_display: group.recommendedPortName,
      agent_display: group.agentContact,
      supplier_display: p.supplierName,
    };
  });
}

export type ConsolidationSuggestionView = {
  productId: string;
  sku: string;
  productName: string;
  recommendedUnits: number;
  cbmTotal: number;
  supplierName: string | null;
  supplierPreferredPortName: string;
  recommendedPortName: string;
  distanceKm: number | null;
  reason: string;
  canAdd: boolean;
};

/** Sugerencias de consolidación por producto (derivado de containerGroups en cliente). */
export function getConsolidationSuggestionsForProduct(
  productId: string,
  groups: ContainerOptimizationGroup[],
  lines: PlannerLineForBasket[],
): ConsolidationSuggestionView[] {
  const lineMap = new Map(lines.map((l) => [l.productId, l]));
  const hostGroup = groups.find(
    (g) =>
      g.status !== "NOT_CONSOLIDABLE" &&
      g.products.some((p) => p.productId === productId),
  );
  if (!hostGroup) return [];

  const hostCbm = lineMap.get(productId)?.cbmTotal ?? 0;
  if (hostCbm >= 65) return [];

  const suggestions: ConsolidationSuggestionView[] = [];

  for (const g of groups) {
    if (g.status === "NOT_CONSOLIDABLE") continue;
    for (const p of g.products) {
      if (p.productId === productId) continue;
      const line = lineMap.get(p.productId);
      if (!line) continue;

      const sameGroup = g.groupId === hostGroup.groupId;
      suggestions.push({
        productId: p.productId,
        sku: p.sku,
        productName: p.productName,
        recommendedUnits: p.recommendedUnits,
        cbmTotal: p.cbmTotal,
        supplierName: p.supplierName,
        supplierPreferredPortName: p.supplierPreferredPortName,
        recommendedPortName: hostGroup.recommendedPortName,
        distanceKm: p.distanceKmToRecommendedPort,
        reason: sameGroup
          ? p.inclusionReason
          : g.recommendedPortName === hostGroup.recommendedPortName
            ? "Mismo puerto"
            : "Ayuda a llenar contenedor",
        canAdd: true,
      });
    }
  }

  const seen = new Set<string>();
  return suggestions.filter((s) => {
    if (seen.has(s.productId)) return false;
    seen.add(s.productId);
    return true;
  });
}
