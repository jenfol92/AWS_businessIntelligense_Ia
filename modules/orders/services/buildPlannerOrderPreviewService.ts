/**
 * Módulo      : orders
 * Archivo     : services/buildPlannerOrderPreviewService.ts
 * Responsabilidad: genera el preview read-only de pedidos desde el planner anual.
 *   1. Ejecuta el análisis del planner (analyzeProducts).
 *   2. Agrupa las líneas del plan en DraftOrderGroups (createDraftOrdersFromAnnualPlan).
 *   3. Convierte cada grupo a DraftPreview (createOrderDraftFromGroup + mapeo).
 *   4. Devuelve stats, summary, groups y drafts sin escribir nada en BD.
 * No debe     : crear órdenes, usar createSupabaseRouteClient directamente,
 *               ni construir respuestas HTTP.
 */

import { analyzeProducts } from "@/modules/planner/services/analyzeProducts";
import { createDraftOrdersFromAnnualPlan } from "@/modules/orders/services/createDraftOrdersFromAnnualPlan";
import { createOrderDraftFromGroup } from "@/modules/orders/services/createOrderDraftFromGroup";
import type { PlannerParams } from "@/modules/planner/types/planner.types";
import type { DraftOrderGroup } from "@/modules/orders/types";
import type {
  DraftPreview,
  ItemPreview,
  PlannerOrderPreviewResult,
} from "@/modules/orders/types/plannerOrderPreview.types";

// ─────────────────────────────────────────────────────────────────────────────
// Defaults de pago (aplicados cuando el proveedor no tiene config en BD)
// TODO: reemplazar con lookup real a proveedores.deposito_porcentaje
//       una vez el módulo de proveedores esté completamente implementado.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PAYMENT = {
  depositPercentage: 30,
  balanceDaysBeforeArrival: 10,
  balanceConditionsText:
    "The balance will be paid 10 days before the vessel arrives at the port",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Mapeador privado: DraftOrderGroup → DraftPreview
// ─────────────────────────────────────────────────────────────────────────────

function buildDraftPreview(group: DraftOrderGroup): DraftPreview {
  const draft = createOrderDraftFromGroup(group, DEFAULT_PAYMENT);

  const itemsPreview: ItemPreview[] = draft.items.map((item) => ({
    sku: item.sku,
    productName: item.productName,
    quantity: item.quantity,
    cbmTotal: item.cbmTotal,
    lineCostEur: item.lineCostEur,
    orderTimingStatus: item.orderTimingStatus,
    daysLate: item.daysLate,
  }));

  return {
    groupKey: group.groupKey,
    supplierName: group.supplierName,
    agentName: group.agentName,
    originPortId: group.originPortId,
    productCount: group.productCount,
    totalUnits: group.totalUnits,
    totalCbm: group.totalCbm,
    totalWeightKg: group.totalWeightKg,
    totalPurchaseCapitalRequired: group.totalPurchaseCapitalRequired,
    estimatedDepositAmount: draft.estimatedDepositAmount,
    estimatedBalanceAmount: draft.estimatedBalanceAmount,
    earliestOrderDate: group.earliestOrderDate,
    latestOrderDate: group.latestOrderDate,
    orderTimingStatus: group.orderTimingStatus,
    isReadyToSubmit: draft.isReadyToSubmit,
    warnings: draft.warnings,
    itemsPreview,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Service público
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Genera el preview completo de pedidos desde el planner.
 *
 * No escribe nada en base de datos. Es una proyección pura en memoria.
 *
 * @param params - Parámetros del planner (scenario, windowDays, horizonMonths, …).
 * @returns stats + summary + groups + drafts.
 * @throws Error si analyzeProducts falla.
 */
export async function buildPlannerOrderPreviewService(
  params: PlannerParams,
): Promise<PlannerOrderPreviewResult> {
  // 1. Ejecutar análisis planner
  const plannerResult = await analyzeProducts(params);

  // 2. Agrupar líneas del plan en grupos por proveedor/puerto/agente
  const { groups, summary } = createDraftOrdersFromAnnualPlan(
    plannerResult.annualPurchasePlan,
  );

  // 3. Construir previews (read-only, sin persistir nada)
  const drafts: DraftPreview[] = groups.map(buildDraftPreview);

  return {
    stats: plannerResult.stats,
    summary,
    groups,
    drafts,
  };
}
