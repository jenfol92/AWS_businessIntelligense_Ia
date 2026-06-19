import type { ArrivalMonth, ArrivalOrder } from "@/modules/planner/types/arrivals.types";
import { matchesArrivalStatusFilter } from "@/modules/planner/utils/arrivalVisualUtils";

export type PlannerArrivalsFiltersState = {
  fromMonth: string;
  monthsCount: number;
  status: string;
  destination: string;
  container: "ALL" | "with" | "without";
  search: string;
};

export function orderMatchesArrivalFilters(
  order: ArrivalOrder,
  filters: PlannerArrivalsFiltersState,
): boolean {
  if (!matchesArrivalStatusFilter(filters.status, order.status)) return false;

  if (filters.container === "with" && !order.containerId) return false;
  if (filters.container === "without" && order.containerId) return false;

  if (filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    const haystack = [
      order.displayCode,
      order.numeroOrden,
      order.numeroPedidoAgente,
      order.containerNumber,
      order.productSummary,
      order.destination,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }

  return true;
}

export function filterArrivalMonths(
  months: ArrivalMonth[],
  filters: PlannerArrivalsFiltersState,
): ArrivalMonth[] {
  return months
    .map((month) => {
      const confirmedEtaOrders = month.confirmedEtaOrders.filter((order) =>
        orderMatchesArrivalFilters(order, filters),
      );
      const estimatedOrders = month.estimatedOrders.filter((order) =>
        orderMatchesArrivalFilters(order, filters),
      );
      const pendingDateOrders = month.pendingDateOrders.filter((order) =>
        orderMatchesArrivalFilters(order, filters),
      );
      const total =
        confirmedEtaOrders.length + estimatedOrders.length + pendingDateOrders.length;

      return {
        ...month,
        confirmedEtaOrders,
        estimatedOrders,
        pendingDateOrders,
        total,
      };
    })
    .filter((month) => month.total > 0);
}

export function flattenArrivalMonthOrders(month: ArrivalMonth): ArrivalOrder[] {
  return [...month.confirmedEtaOrders, ...month.estimatedOrders, ...month.pendingDateOrders];
}

export function flattenAllArrivalOrders(months: ArrivalMonth[]): ArrivalOrder[] {
  return months.flatMap(flattenArrivalMonthOrders);
}
