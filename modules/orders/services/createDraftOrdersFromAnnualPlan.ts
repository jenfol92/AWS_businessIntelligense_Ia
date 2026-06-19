/**
 * Fase 0A — Preview de borradores de pedido desde el plan anual de compras.
 *
 * Transforma las líneas de un AnnualPurchasePlanResult en grupos de pedido
 * agrupados por (supplierId, originPortId, agentId). No inserta nada en BD,
 * no crea endpoints, no produce frontend: es sólo una proyección en memoria
 * lista para revisión humana o para pasarla a Fase 1 (createOrden).
 */

import type { AnnualPurchasePlanLine, AnnualPurchasePlanResult } from "@/modules/planner/types/planner.types";
import {
  CBM_40HQ,
  CBM_20GP,
  type CreateDraftOrdersResult,
  type DraftOrderContainerEstimate,
  type DraftOrderGroup,
  type DraftOrderGroupKeyString,
  type DraftOrderGroupSummary,
  type DraftOrderTimingStatus,
} from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

const NULL_SEGMENT = "NULL";

function buildGroupKey(
  supplierId: string | null | undefined,
  originPortId: string | null | undefined,
  agentId: string | null | undefined,
): DraftOrderGroupKeyString {
  const s = supplierId ?? NULL_SEGMENT;
  const p = originPortId ?? NULL_SEGMENT;
  const a = agentId ?? NULL_SEGMENT;
  return `${s}|${p}|${a}`;
}

/**
 * Returns the worst-case timing status across an array of lines:
 * OVERDUE > DUE_NOW > ON_TIME.
 */
function aggregateTimingStatus(
  lines: AnnualPurchasePlanLine[],
): DraftOrderTimingStatus {
  let hasDueNow = false;

  for (const line of lines) {
    if (line.orderTimingStatus === "OVERDUE") return "OVERDUE";
    if (line.orderTimingStatus === "DUE_NOW") hasDueNow = true;
  }

  return hasDueNow ? "DUE_NOW" : "ON_TIME";
}

/**
 * Returns the earliest ISO date string from a list of nullable dates.
 * Null/empty strings are ignored.
 */
function minDate(dates: (string | null)[]): string | null {
  const valid = dates.filter((d): d is string => d != null && d.trim() !== "");
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a < b ? a : b));
}

/** Returns the latest ISO date string from a list of nullable dates. */
function maxDate(dates: (string | null)[]): string | null {
  const valid = dates.filter((d): d is string => d != null && d.trim() !== "");
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => (a > b ? a : b));
}

function buildContainerEstimate(totalCbm: number, hasCbmData: boolean): DraftOrderContainerEstimate {
  if (!hasCbmData || totalCbm <= 0) {
    return {
      hasCbmData,
      requiresContainer: false,
      estimatedContainers40HQ: 0,
      estimatedContainers20GP: 0,
      fillRate40HQ: hasCbmData ? 0 : null,
    };
  }

  return {
    hasCbmData: true,
    requiresContainer: true,
    estimatedContainers40HQ: Math.ceil(totalCbm / CBM_40HQ),
    estimatedContainers20GP: Math.ceil(totalCbm / CBM_20GP),
    fillRate40HQ: parseFloat((totalCbm / CBM_40HQ).toFixed(4)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core grouping logic
// ─────────────────────────────────────────────────────────────────────────────

type Accumulator = {
  lines: AnnualPurchasePlanLine[];
  supplierId: string | null;
  supplierName: string | null;
  agentId: string | null;
  agentName: string | null;
  originPortId: string | null;
};

function groupLines(
  lines: AnnualPurchasePlanLine[],
): Map<DraftOrderGroupKeyString, Accumulator> {
  const map = new Map<DraftOrderGroupKeyString, Accumulator>();

  for (const line of lines) {
    const key = buildGroupKey(line.supplierId, line.originPortId, line.agentId);

    if (!map.has(key)) {
      map.set(key, {
        lines: [],
        supplierId: line.supplierId ?? null,
        supplierName: line.supplierName ?? null,
        agentId: line.agentId ?? null,
        agentName: line.agentName ?? null,
        originPortId: line.originPortId ?? null,
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    map.get(key)!.lines.push(line);
  }

  return map;
}

function aggregateGroup(
  groupKey: DraftOrderGroupKeyString,
  acc: Accumulator,
): DraftOrderGroup {
  const { lines, supplierId, supplierName, agentId, agentName, originPortId } = acc;

  let totalUnits = 0;
  let totalCbm = 0;
  let totalWeightKg = 0;
  let totalPurchaseCapitalRequired = 0;
  let cbmLineCount = 0; // lines that actually have cbmTotal data
  let overdueLineCount = 0;
  let dueNowLineCount = 0;
  let consolidableLineCount = 0;

  for (const line of lines) {
    totalUnits += line.recommendedOrderUnits;

    if (line.cbmTotal != null) {
      totalCbm += line.cbmTotal;
      cbmLineCount++;
    }

    if (line.weightKgTotal != null) {
      totalWeightKg += line.weightKgTotal;
    }

    if (line.purchaseCapitalRequired != null) {
      totalPurchaseCapitalRequired += line.purchaseCapitalRequired;
    }

    if (line.orderTimingStatus === "OVERDUE") overdueLineCount++;
    if (line.orderTimingStatus === "DUE_NOW") dueNowLineCount++;
    if (line.consolidationEligible) consolidableLineCount++;
  }

  const hasCbmData = cbmLineCount > 0;
  const containerEstimate = buildContainerEstimate(totalCbm, hasCbmData);

  const orderDates = lines.map((l) => l.recommendedOrderDate);

  return {
    groupKey,
    supplierId,
    supplierName,
    agentId,
    agentName,
    originPortId,
    lines,
    totalUnits,
    totalCbm: parseFloat(totalCbm.toFixed(4)),
    totalWeightKg: parseFloat(totalWeightKg.toFixed(2)),
    totalPurchaseCapitalRequired: parseFloat(totalPurchaseCapitalRequired.toFixed(2)),
    containerEstimate,
    earliestOrderDate: minDate(orderDates),
    latestOrderDate: maxDate(orderDates),
    orderTimingStatus: aggregateTimingStatus(lines),
    overdueLineCount,
    dueNowLineCount,
    consolidableLineCount,
    productCount: lines.length,
  };
}

function buildSummary(groups: DraftOrderGroup[]): DraftOrderGroupSummary {
  let totalLines = 0;
  let totalUnits = 0;
  let totalCbm = 0;
  let totalWeightKg = 0;
  let totalPurchaseCapitalRequired = 0;
  let groupsWithContainer = 0;
  let groupsWithIncompleteData = 0;
  let groupsOverdue = 0;
  let groupsDueNow = 0;

  for (const g of groups) {
    totalLines += g.lines.length;
    totalUnits += g.totalUnits;
    totalCbm += g.totalCbm;
    totalWeightKg += g.totalWeightKg;
    totalPurchaseCapitalRequired += g.totalPurchaseCapitalRequired;

    if (g.containerEstimate.requiresContainer) groupsWithContainer++;
    if (!g.containerEstimate.hasCbmData) groupsWithIncompleteData++;
    if (g.orderTimingStatus === "OVERDUE") groupsOverdue++;
    if (g.orderTimingStatus === "DUE_NOW") groupsDueNow++;
  }

  return {
    totalGroups: groups.length,
    totalLines,
    totalUnits,
    totalCbm: parseFloat(totalCbm.toFixed(4)),
    totalWeightKg: parseFloat(totalWeightKg.toFixed(2)),
    totalPurchaseCapitalRequired: parseFloat(totalPurchaseCapitalRequired.toFixed(2)),
    groupsWithContainer,
    groupsWithIncompleteData,
    groupsOverdue,
    groupsDueNow,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Groups AnnualPurchasePlan lines into DraftOrderGroups for human review.
 *
 * Grouping dimensions (all three must match for lines to be consolidated):
 *   - supplierId       → same supplier
 *   - originPortId     → same port of origin (supplier port)
 *   - agentId          → same buying agent (agent supplier port)
 *
 * Lines with null dimensions are grouped together under NULL keys, which
 * means they cannot be consolidated without completing their master data.
 *
 * @param annualPlan - Output of buildAnnualPurchasePlan / analyzeProducts
 * @returns Grouped draft orders + summary. Nothing is written to the DB.
 */
export function createDraftOrdersFromAnnualPlan(
  annualPlan: Pick<AnnualPurchasePlanResult, "lines">,
): CreateDraftOrdersResult {
  const { lines } = annualPlan;

  if (lines.length === 0) {
    return {
      groups: [],
      summary: {
        totalGroups: 0,
        totalLines: 0,
        totalUnits: 0,
        totalCbm: 0,
        totalWeightKg: 0,
        totalPurchaseCapitalRequired: 0,
        groupsWithContainer: 0,
        groupsWithIncompleteData: 0,
        groupsOverdue: 0,
        groupsDueNow: 0,
      },
    };
  }

  const grouped = groupLines(lines);

  // Sort groups: OVERDUE first, then DUE_NOW, then ON_TIME; within each bucket
  // sort by totalCbm descending (largest shipment first).
  const TIMING_ORDER: Record<DraftOrderTimingStatus, number> = {
    OVERDUE: 0,
    DUE_NOW: 1,
    ON_TIME: 2,
  };

  const groups: DraftOrderGroup[] = Array.from(grouped.entries())
    .map(([key, acc]) => aggregateGroup(key, acc))
    .sort((a, b) => {
      const timingDiff =
        TIMING_ORDER[a.orderTimingStatus] - TIMING_ORDER[b.orderTimingStatus];
      if (timingDiff !== 0) return timingDiff;
      return b.totalCbm - a.totalCbm;
    });

  const summary = buildSummary(groups);

  return { groups, summary };
}
