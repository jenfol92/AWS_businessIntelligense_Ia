/**
 * Módulo      : orders
 * Archivo     : types/plannerOrderPreview.types.ts
 * Responsabilidad: contratos de respuesta para el preview de pedidos desde planner.
 *                  Usado por buildPlannerOrderPreviewService y planner-preview/route.ts.
 * No debe     : contener lógica de negocio ni acceso a datos.
 */

import type { DraftOrderGroup, DraftOrderGroupSummary, DraftOrderTimingStatus } from "@/modules/orders/types";
import type { OrderDraftWarning } from "@/modules/orders/types/order.types";
import type { analyzeProducts } from "@/modules/planner/services/analyzeProducts";

/** Tipo del campo stats que devuelve analyzeProducts. */
export type PlannerStats = Awaited<ReturnType<typeof analyzeProducts>>["stats"];

// ─────────────────────────────────────────────────────────────────────────────
// Preview por línea de pedido
// ─────────────────────────────────────────────────────────────────────────────

export type ItemPreview = {
  sku: string;
  productName: string | undefined;
  quantity: number;
  cbmTotal: number | null;
  lineCostEur: number | null;
  orderTimingStatus: "ON_TIME" | "DUE_NOW" | "OVERDUE";
  daysLate: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Preview de borrador de pedido
// ─────────────────────────────────────────────────────────────────────────────

export type DraftPreview = {
  groupKey: string;
  supplierName: string | null;
  agentName: string | null;
  originPortId: string | null;
  productCount: number;
  totalUnits: number;
  totalCbm: number;
  totalWeightKg: number;
  totalPurchaseCapitalRequired: number;
  estimatedDepositAmount: number;
  estimatedBalanceAmount: number;
  earliestOrderDate: string | null;
  latestOrderDate: string | null;
  orderTimingStatus: DraftOrderTimingStatus;
  isReadyToSubmit: boolean;
  warnings: OrderDraftWarning[];
  itemsPreview: ItemPreview[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Resultado completo del service de preview
// ─────────────────────────────────────────────────────────────────────────────

export type PlannerOrderPreviewResult = {
  stats: PlannerStats;
  summary: DraftOrderGroupSummary;
  groups: DraftOrderGroup[];
  drafts: DraftPreview[];
};
