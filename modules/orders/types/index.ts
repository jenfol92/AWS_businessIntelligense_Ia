import type { AnnualPurchasePlanLine } from "@/modules/planner/types/planner.types";

// ─────────────────────────────────────────────────────────────────────────────
// Container capacity constants (sea freight standard)
// ─────────────────────────────────────────────────────────────────────────────
export const CBM_40HQ = 65; // m³ usable capacity for 40-foot High Cube
export const CBM_20GP = 33; // m³ usable capacity for 20-foot General Purpose

// ─────────────────────────────────────────────────────────────────────────────
// Grouping key components derived from AnnualPurchasePlanLine
// ─────────────────────────────────────────────────────────────────────────────

/** Three dimensions that define a unique procurement route. */
export type DraftOrderGroupKey = {
  supplierId: string | null;
  originPortId: string | null;
  agentId: string | null;
};

/** Serialised composite key used as Map key. */
export type DraftOrderGroupKeyString = string;

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate timing derived from the lines in a group
// ─────────────────────────────────────────────────────────────────────────────

export type DraftOrderTimingStatus = "ON_TIME" | "DUE_NOW" | "OVERDUE";

// ─────────────────────────────────────────────────────────────────────────────
// Container recommendation for a draft order group
// ─────────────────────────────────────────────────────────────────────────────

export type DraftOrderContainerEstimate = {
  /**
   * True when the group has at least one line with a known CBM.
   * False means CBM data is incomplete — container count cannot be determined.
   */
  hasCbmData: boolean;

  /**
   * True when the group requires at least one sea container
   * (i.e., hasCbmData && totalCbm > 0).
   */
  requiresContainer: boolean;

  /** Minimum 40HQ containers needed to ship the full group. */
  estimatedContainers40HQ: number;

  /** Minimum 20GP containers needed to ship the full group. */
  estimatedContainers20GP: number;

  /**
   * Proportion of a single 40HQ container this group would fill.
   * Null when CBM data is unavailable.
   */
  fillRate40HQ: number | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Main output type
// ─────────────────────────────────────────────────────────────────────────────

export type DraftOrderGroup = {
  /**
   * Stable composite key: `supplierId|originPortId|agentId`.
   * Null dimensions are represented as the literal string "NULL".
   */
  groupKey: DraftOrderGroupKeyString;

  // ── Identity ──────────────────────────────────────────────────────────────
  supplierId: string | null;
  supplierName: string | null;
  agentId: string | null;
  agentName: string | null;
  originPortId: string | null;

  // ── Plan lines that belong to this group ──────────────────────────────────
  lines: AnnualPurchasePlanLine[];

  // ── Aggregated volumes ────────────────────────────────────────────────────
  totalUnits: number;

  /**
   * Sum of cbmTotal across all lines.
   * Lines with null cbmTotal contribute 0 — check hasCbmData to know
   * whether this sum is complete.
   */
  totalCbm: number;

  /**
   * Sum of weightKgTotal across all lines.
   * Lines with null weightKgTotal contribute 0.
   */
  totalWeightKg: number;

  /**
   * Sum of purchaseCapitalRequired across all lines.
   * Lines with null purchaseCapitalRequired contribute 0.
   */
  totalPurchaseCapitalRequired: number;

  // ── Container recommendation ──────────────────────────────────────────────
  containerEstimate: DraftOrderContainerEstimate;

  // ── Timing ────────────────────────────────────────────────────────────────
  /**
   * Earliest recommendedOrderDate among lines in the group.
   * Null when no line has a date.
   */
  earliestOrderDate: string | null;

  /**
   * Latest recommendedOrderDate among lines in the group.
   * Null when no line has a date.
   */
  latestOrderDate: string | null;

  /**
   * Worst-case timing status across all lines:
   * OVERDUE > DUE_NOW > ON_TIME.
   */
  orderTimingStatus: DraftOrderTimingStatus;

  /** Number of lines in this group with OVERDUE status. */
  overdueLineCount: number;

  /** Number of lines in this group with DUE_NOW status. */
  dueNowLineCount: number;

  // ── Consolidation ─────────────────────────────────────────────────────────
  /** Number of lines where consolidationEligible = true. */
  consolidableLineCount: number;

  /** Number of distinct products in this group. */
  productCount: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Summary returned alongside the groups
// ─────────────────────────────────────────────────────────────────────────────

export type DraftOrderGroupSummary = {
  totalGroups: number;
  totalLines: number;
  totalUnits: number;
  totalCbm: number;
  totalWeightKg: number;
  totalPurchaseCapitalRequired: number;
  groupsWithContainer: number;
  groupsWithIncompleteData: number;
  groupsOverdue: number;
  groupsDueNow: number;
};

export type CreateDraftOrdersResult = {
  groups: DraftOrderGroup[];
  summary: DraftOrderGroupSummary;
};
