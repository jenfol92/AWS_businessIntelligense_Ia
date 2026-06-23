/**
 * Módulo      : orders
 * Archivo     : services/createOrderFromPlannerService.ts
 * Responsabilidad: orquestación completa del flujo planner → pedido real:
 *   1. Ejecuta el análisis del planner (analyzeProducts).
 *   2. Agrupa las líneas en DraftOrderGroups.
 *   3. Localiza el grupo solicitado por groupKey.
 *   4. Convierte el grupo a OrderDraft (createOrderDraftFromGroup).
 *   5. Valida que el draft esté listo para insertar (isReadyToSubmit).
 *   6. Persiste el pedido (createOrderFromDraft).
 *   7. Devuelve unión discriminada con el resultado o la causa de fallo.
 * No debe     : gestionar autenticación, construir respuestas HTTP,
 *               cambiar lógica de CBM/costes/snapshots ni tocar finanzas.
 *
 * IMPORTANTE: Este endpoint crea pedidos reales en BD.
 * El orden de operaciones no debe cambiarse.
 */

import { analyzeProducts } from "@/modules/planner/services/analyzeProducts";
import { createDraftOrdersFromAnnualPlan } from "@/modules/orders/services/createDraftOrdersFromAnnualPlan";
import { createOrderDraftFromGroup } from "@/modules/orders/services/createOrderDraftFromGroup";
import { createOrderFromDraft } from "@/modules/orders/services/createOrderFromDraft";
import type { PlannerParams } from "@/modules/planner/types/planner.types";
import type { DraftOrderGroup } from "@/modules/orders/types";
import type { OrderDraft, OrderDraftWarning } from "@/modules/orders/types/order.types";
import type {
  OrdenCompraRow,
  OrdenItemRow,
} from "@/modules/orders/types/orderPersistence.types";
import type { OrderCreateErrorCode } from "@/modules/orders/services/createOrderDraftService";

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
// Tipo de resultado del service
// ─────────────────────────────────────────────────────────────────────────────

/** Resumen de los grupos disponibles (devuelto cuando el groupKey no existe). */
export type AvailableGroupKey = {
  groupKey: string;
  supplierName: string | null;
  originPortId: string | null;
  productCount: number;
};

export type CreateOrderFromPlannerResult =
  | {
      ok: true;
      groupKey: string;
      draft: OrderDraft;
      orden: OrdenCompraRow;
      items: OrdenItemRow[];
    }
  | {
      ok: false;
      code: "PLANNER_ERROR";
      error: string;
    }
  | {
      ok: false;
      code: "GROUP_NOT_FOUND";
      error: string;
      availableGroupKeys: AvailableGroupKey[];
    }
  | {
      ok: false;
      code: "DRAFT_NOT_READY";
      error: string;
      groupKey: string;
      draft: OrderDraft;
      warnings: OrderDraftWarning[];
    }
  | {
      ok: false;
      code: OrderCreateErrorCode;
      error: string;
    };

// ─────────────────────────────────────────────────────────────────────────────
// Service público
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta el pipeline completo planner → borrador → pedido persistido.
 *
 * @param groupKey     - Clave del grupo a convertir en pedido.
 * @param plannerParams - Parámetros del análisis planner.
 * @returns Unión discriminada con el pedido creado o la causa de fallo.
 */
export async function createOrderFromPlannerService(
  groupKey: string,
  plannerParams: PlannerParams,
): Promise<CreateOrderFromPlannerResult> {
  // ── 1. Ejecutar análisis planner ──────────────────────────────────────────
  let groups: DraftOrderGroup[];

  try {
    const plannerResult = await analyzeProducts(plannerParams);
    const draftResult = createDraftOrdersFromAnnualPlan(plannerResult.annualPurchasePlan);
    groups = draftResult.groups;
  } catch (err) {
    return {
      ok: false,
      code: "PLANNER_ERROR",
      error:
        err instanceof Error
          ? err.message
          : "Error al ejecutar el análisis del planner.",
    };
  }

  // ── 2. Localizar el grupo solicitado ──────────────────────────────────────
  const group = groups.find((g) => g.groupKey === groupKey);

  if (!group) {
    const availableGroupKeys: AvailableGroupKey[] = groups.map((g) => ({
      groupKey: g.groupKey,
      supplierName: g.supplierName,
      originPortId: g.originPortId,
      productCount: g.productCount,
    }));

    return {
      ok: false,
      code: "GROUP_NOT_FOUND",
      error: "Grupo no encontrado.",
      availableGroupKeys,
    };
  }

  // ── 3. Convertir grupo a OrderDraft ───────────────────────────────────────
  const draft = createOrderDraftFromGroup(group, DEFAULT_PAYMENT);

  // ── 4. Validar que el draft esté listo para insertar ─────────────────────
  if (!draft.isReadyToSubmit) {
    return {
      ok: false,
      code: "DRAFT_NOT_READY",
      error: "El borrador no está listo para crear orden.",
      groupKey,
      draft,
      warnings: draft.warnings,
    };
  }

  // ── 5. Persistir pedido ───────────────────────────────────────────────────
  const orderResult = await createOrderFromDraft(draft);

  if (orderResult.ok === false) {
    // Explicit cast needed because TypeScript doesn't always narrow `!ok` on
    // discriminated unions with multiple `false` branches.
    const err = orderResult as Extract<typeof orderResult, { ok: false }>;
    return {
      ok: false,
      code: err.code,
      error: err.message,
    };
  }

  // ── 6. Éxito ──────────────────────────────────────────────────────────────
  return {
    ok: true,
    groupKey,
    draft,
    orden: orderResult.orden,
    items: orderResult.items,
  };
}
