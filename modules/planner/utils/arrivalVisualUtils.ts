import type { ArrivalOrder } from "@/modules/planner/types/arrivals.types";
import { todayDateOnly } from "@/modules/planner/utils/arrivalsDateUtils";

export type ArrivalVisualCategory =
  | "entregada"
  | "atrasada"
  | "confirmada"
  | "estimada"
  | "sin_definir";

export function computeArrivalFlags(params: {
  hasDefinedEta: boolean;
  estimatedMonthDate: string | null;
  status: ArrivalOrder["status"];
}): { isDelivered: boolean; isDelayed: boolean } {
  const isDelivered = params.status === "entregado";
  const isDelayed =
    !isDelivered
    && params.hasDefinedEta
    && !!params.estimatedMonthDate
    && params.estimatedMonthDate < todayDateOnly();

  return { isDelivered, isDelayed };
}

export function getArrivalVisualCategory(order: ArrivalOrder): ArrivalVisualCategory {
  if (order.isDelivered) return "entregada";
  if (order.isDelayed) return "atrasada";
  if (order.hasDefinedEta) return "confirmada";
  if (order.estimatedMonthDate) return "estimada";
  return "sin_definir";
}

export function matchesArrivalStatusFilter(
  filter: string | null | undefined,
  status: ArrivalOrder["status"],
): boolean {
  if (!filter || filter === "ALL") return true;
  return status === filter;
}
