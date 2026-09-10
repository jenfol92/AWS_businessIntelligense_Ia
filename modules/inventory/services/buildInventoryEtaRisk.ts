import type { InventoryInboundRow } from "../types/inventory.types.ts";
import { usableForPlanning } from "../../planner/services/resolveInboundPlanningKind.ts";

export type InventoryEtaRisk = {
  stockoutBeforeInbound: boolean;
  stockoutDate: string | null;
  nextRelevantConfirmedEta: string | null;
  gapDays: number | null;
};

export function buildInventoryEtaRisk(
  estimatedStockoutDate: string | null | undefined,
  inbound: readonly InventoryInboundRow[],
): InventoryEtaRisk {
  const stockoutDate = estimatedStockoutDate?.slice(0, 10) ?? null;
  if (!stockoutDate) return { stockoutBeforeInbound: false, stockoutDate: null, nextRelevantConfirmedEta: null, gapDays: null };
  const nextRelevantConfirmedEta = inbound
    .filter(
      (row) =>
        row.planningKind != null &&
        usableForPlanning(row.planningKind) &&
        row.usableForPlanning !== false &&
        row.cantidadPendiente > 0 &&
        row.eta,
    )
    .map((row) => row.eta!.slice(0, 10))
    .filter((eta) => eta > stockoutDate)
    .sort()[0] ?? null;
  const gapDays = nextRelevantConfirmedEta
    ? Math.max(0, Math.round((Date.parse(`${nextRelevantConfirmedEta}T00:00:00Z`) - Date.parse(`${stockoutDate}T00:00:00Z`)) / 86_400_000))
    : null;
  return { stockoutBeforeInbound: true, stockoutDate, nextRelevantConfirmedEta, gapDays };
}
