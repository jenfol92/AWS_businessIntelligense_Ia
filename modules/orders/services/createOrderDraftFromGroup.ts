/**
 * Fase 0B — Transforms a DraftOrderGroup into an OrderDraft.
 *
 * Pure in-memory transformation. No DB writes, no endpoints, no UI.
 * The resulting OrderDraft mirrors the shape of ordenes_compra + orden_items
 * so Fase 1 (createOrden) can insert it with minimal mapping.
 *
 * Payment formula:
 *   depositDate  = group.earliestOrderDate (or today)
 *   balanceDate  = estimatedArrivalDate − balanceDaysBeforeArrival
 *   where estimatedArrivalDate = recommendedOrderDate
 *                                + leadTimeProductionDays
 *                                + leadTimeSeaDays
 *                               (already pre-computed in AnnualPurchasePlanLine.estimatedArrivalDate)
 */

import { CBM_40HQ } from "../types";
import type { DraftOrderGroup } from "../types";
import {
  DEFAULT_BALANCE_CONDITIONS_TEXT,
  DEFAULT_BALANCE_DAYS_BEFORE_ARRIVAL,
  DEFAULT_DEPOSIT_PERCENTAGE,
  type OrderDraft,
  type OrderDraftItem,
  type OrderDraftWarning,
  type OrderDraftWarningCode,
  type PaymentSchedule,
  type SupplierPaymentDefaults,
} from "../types/order.types";

// ─────────────────────────────────────────────────────────────────────────────
// Date utilities (pure, UTC-safe)
// ─────────────────────────────────────────────────────────────────────────────

function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addCalendarDaysToIso(isoDate: string, days: number): string | null {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isBeforeToday(isoDate: string): boolean {
  return isoDate < utcTodayIso();
}

function earliestValidDate(dates: (string | null)[]): string | null {
  const valid = dates.filter((d): d is string => d != null && d.trim() !== "");
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a < b ? a : b));
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment schedule
// ─────────────────────────────────────────────────────────────────────────────

function buildPaymentSchedule(args: {
  totalCostEur: number;
  depositPercentage: number;
  balanceDaysBeforeArrival: number;
  balanceConditionsText: string;
  depositDate: string | null;
  earliestArrivalDate: string | null;
}): PaymentSchedule {
  const {
    totalCostEur,
    depositPercentage,
    balanceDaysBeforeArrival,
    balanceConditionsText,
    depositDate,
    earliestArrivalDate,
  } = args;

  const depositAmount = parseFloat(
    (totalCostEur * (depositPercentage / 100)).toFixed(2),
  );
  const balancePercentage = 100 - depositPercentage;
  const balanceAmount = parseFloat((totalCostEur - depositAmount).toFixed(2));

  const balanceDate =
    earliestArrivalDate != null
      ? addCalendarDaysToIso(earliestArrivalDate, -balanceDaysBeforeArrival)
      : null;

  return {
    depositPercentage,
    depositAmount,
    depositDate,
    balancePercentage,
    balanceAmount,
    balanceDate,
    balanceDaysBeforeArrival,
    balanceConditionsText,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Items mapping
// ─────────────────────────────────────────────────────────────────────────────

function buildItems(group: DraftOrderGroup): OrderDraftItem[] {
  return group.lines.map((line) => {
    const cbmPerUnit =
      line.cbmTotal != null && line.recommendedOrderUnits > 0
        ? parseFloat(
            (line.cbmTotal / line.recommendedOrderUnits).toFixed(6),
          )
        : null;

    const lineCostEur =
      line.unitPurchaseCost != null
        ? parseFloat(
            (line.unitPurchaseCost * line.recommendedOrderUnits).toFixed(2),
          )
        : null;

    return {
      productId: line.productId,
      sku: line.sku,
      productName: line.productName,
      supplierId: group.supplierId,
      quantity: line.recommendedOrderUnits,
      cbmPerUnit,
      cbmTotal: line.cbmTotal,
      weightKgTotal: line.weightKgTotal,
      unitCostEur: line.unitPurchaseCost,
      lineCostEur,
      recommendedOrderDate: line.recommendedOrderDate,
      estimatedArrivalDate: line.estimatedArrivalDate,
      orderTimingStatus: line.orderTimingStatus,
      daysLate: line.daysLate,
      moqApplied: line.moqApplied,
      cartonMultipleApplied: line.cartonMultipleApplied,
      consolidationEligible: line.consolidationEligible,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Warnings
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true when this warning code should block DB insertion. */
function isBlockingWarning(code: OrderDraftWarningCode): boolean {
  return code === "NO_SUPPLIER" || code === "MISSING_CBM_DATA";
}

function buildWarnings(
  group: DraftOrderGroup,
  paymentSchedule: PaymentSchedule,
): OrderDraftWarning[] {
  const warnings: OrderDraftWarning[] = [];

  if (group.supplierId == null) {
    warnings.push({
      code: "NO_SUPPLIER",
      message:
        "No hay proveedor asignado. Completa el master data antes de crear el pedido.",
    });
  }

  if (group.originPortId == null) {
    warnings.push({
      code: "NO_ORIGIN_PORT",
      message:
        "Puerto de origen desconocido. Revisa el proveedor en la tabla proveedores.",
    });
  }

  if (!group.containerEstimate.hasCbmData) {
    const missingCbmProducts = group.lines
      .filter((l) => l.cbmTotal == null)
      .map((l) => l.productId);
    warnings.push({
      code: "MISSING_CBM_DATA",
      message:
        "Uno o más productos no tienen cubicaje configurado en producto_logistica. El cálculo de contenedores no es fiable.",
      affectedProductIds: missingCbmProducts,
    });
  }

  const missingCostProducts = group.lines
    .filter((l) => l.purchaseCapitalRequired == null)
    .map((l) => l.productId);
  if (missingCostProducts.length > 0) {
    warnings.push({
      code: "MISSING_COST_DATA",
      message:
        "Algunos productos no tienen coste de compra definido. El capital requerido es una estimación parcial.",
      affectedProductIds: missingCostProducts,
    });
  }

  if (group.overdueLineCount > 0) {
    const overdueProducts = group.lines
      .filter((l) => l.orderTimingStatus === "OVERDUE")
      .map((l) => l.productId);
    warnings.push({
      code: "OVERDUE_LINES",
      message: `${group.overdueLineCount} línea(s) superan la fecha de pedido recomendada. Riesgo de ruptura de stock.`,
      affectedProductIds: overdueProducts,
    });
  }

  if (
    paymentSchedule.depositDate != null &&
    isBeforeToday(paymentSchedule.depositDate)
  ) {
    warnings.push({
      code: "DEPOSIT_DATE_BEFORE_TODAY",
      message: `La fecha de depósito (${paymentSchedule.depositDate}) es anterior a hoy. Revisa la fecha de pedido.`,
    });
  }

  if (
    paymentSchedule.balanceDate != null &&
    isBeforeToday(paymentSchedule.balanceDate)
  ) {
    warnings.push({
      code: "BALANCE_DATE_BEFORE_TODAY",
      message: `La fecha de pago del balance (${paymentSchedule.balanceDate}) es anterior a hoy. El plan de compra puede estar muy retrasado.`,
    });
  }

  if (
    paymentSchedule.depositDate != null &&
    paymentSchedule.balanceDate != null &&
    paymentSchedule.balanceDate <= paymentSchedule.depositDate
  ) {
    warnings.push({
      code: "BALANCE_DATE_BEFORE_DEPOSIT_DATE",
      message: `La fecha de balance (${paymentSchedule.balanceDate}) es igual o anterior a la fecha de depósito (${paymentSchedule.depositDate}). Revisa los plazos de entrega del proveedor.`,
    });
  }

  return warnings;
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead time estimation from plan lines
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimates total lead time in days from a line's recommendedOrderDate and
 * estimatedArrivalDate. Returns null when either date is missing.
 */
function estimateLeadTimeDaysFromLine(
  recommendedOrderDate: string | null,
  estimatedArrivalDate: string | null,
): number | null {
  if (recommendedOrderDate == null || estimatedArrivalDate == null) return null;
  const fromMs = Date.parse(`${recommendedOrderDate}T00:00:00.000Z`);
  const toMs = Date.parse(`${estimatedArrivalDate}T00:00:00.000Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  const days = Math.round((toMs - fromMs) / 86400000);
  return days > 0 ? days : null;
}

/**
 * Returns the median total lead time across all lines that have both dates.
 * Falls back to null when no lines have enough data.
 */
function medianLeadTimeDays(group: DraftOrderGroup): number | null {
  const values = group.lines
    .map((l) =>
      estimateLeadTimeDaysFromLine(
        l.recommendedOrderDate,
        l.estimatedArrivalDate,
      ),
    )
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);

  if (values.length === 0) return null;
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? Math.round((values[mid - 1] + values[mid]) / 2)
    : values[mid];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transforms a DraftOrderGroup into an OrderDraft.
 *
 * @param group - A single group from createDraftOrdersFromAnnualPlan output.
 * @param supplierPaymentDefaults - Optional payment terms from proveedores table.
 *   When absent, defaults: 30% deposit, 10 days before arrival for balance.
 * @returns OrderDraft ready for human review and then Fase 1 DB insertion.
 */
export function createOrderDraftFromGroup(
  group: DraftOrderGroup,
  supplierPaymentDefaults?: SupplierPaymentDefaults,
): OrderDraft {
  const today = utcTodayIso();

  // ── Resolved payment defaults ──────────────────────────────────────────────
  const depositPercentage =
    supplierPaymentDefaults?.depositPercentage != null &&
    supplierPaymentDefaults.depositPercentage >= 0 &&
    supplierPaymentDefaults.depositPercentage <= 100
      ? supplierPaymentDefaults.depositPercentage
      : DEFAULT_DEPOSIT_PERCENTAGE;

  const balanceDaysBeforeArrival =
    supplierPaymentDefaults?.balanceDaysBeforeArrival != null &&
    supplierPaymentDefaults.balanceDaysBeforeArrival >= 0
      ? supplierPaymentDefaults.balanceDaysBeforeArrival
      : DEFAULT_BALANCE_DAYS_BEFORE_ARRIVAL;

  const balanceConditionsText =
    supplierPaymentDefaults?.balanceConditionsText?.trim() ||
    DEFAULT_BALANCE_CONDITIONS_TEXT;

  // ── Date anchors ───────────────────────────────────────────────────────────
  const depositDate = group.earliestOrderDate ?? today;

  const earliestArrivalDate = earliestValidDate(
    group.lines.map((l) => l.estimatedArrivalDate),
  );

  // ── Payment schedule ───────────────────────────────────────────────────────
  const paymentSchedule = buildPaymentSchedule({
    totalCostEur: group.totalPurchaseCapitalRequired,
    depositPercentage,
    balanceDaysBeforeArrival,
    balanceConditionsText,
    depositDate,
    earliestArrivalDate,
  });

  // ── Lead time estimation ───────────────────────────────────────────────────
  const totalLeadTimeDays = medianLeadTimeDays(group);

  // ── Items ──────────────────────────────────────────────────────────────────
  const items = buildItems(group);

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings = buildWarnings(group, paymentSchedule);

  const isReadyToSubmit = !warnings.some((w) => isBlockingWarning(w.code));

  // ── Assemble OrderDraft ────────────────────────────────────────────────────
  return {
    // Status
    estado: "borrador",

    // Supplier / agent
    supplierId: group.supplierId,
    supplierName: group.supplierName,
    agentId: group.agentId,
    agentName: group.agentName,

    // Ports
    fobPuerto: group.originPortId,
    destino: null,

    // Dates
    fechaOrden: today,
    recommendedOrderDate: group.earliestOrderDate,
    etd: null,
    eta: earliestArrivalDate,
    leadTimeProduccion: null,
    leadTimeTransito: totalLeadTimeDays,

    // Volumes
    cbmTotal: group.totalCbm,
    cbmLimite: CBM_40HQ,

    // Costs
    costeTotalEur: group.totalPurchaseCapitalRequired,
    costeTotalUsd: null,
    tipoCambioUsdEur: null,

    // Additional aggregates
    totalUnits: group.totalUnits,
    totalWeightKg: group.totalWeightKg,

    // Payment
    paymentSchedule,
    estimatedDepositAmount: paymentSchedule.depositAmount,
    estimatedBalanceAmount: paymentSchedule.balanceAmount,

    // Container
    containerEstimate: group.containerEstimate,

    // Items
    items,

    // Validation
    warnings,
    isReadyToSubmit,

    // Traceability
    sourcePlanGroupKey: group.groupKey,
  };
}
