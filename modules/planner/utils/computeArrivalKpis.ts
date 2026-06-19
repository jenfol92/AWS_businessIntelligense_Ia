import { getArrivalVisualCategory } from "@/modules/planner/utils/arrivalVisualUtils";
import type { ArrivalOrder } from "@/modules/planner/types/arrivals.types";

export function computeArrivalKpis(orders: ArrivalOrder[], currentMonth: string) {
  let confirmed = 0;
  let estimated = 0;
  let undefinedEta = 0;
  let thisMonth = 0;
  let delayed = 0;
  let delivered = 0;

  for (const order of orders) {
    const category = getArrivalVisualCategory(order);
    if (category === "entregada") delivered += 1;
    if (category === "confirmada") confirmed += 1;
    if (category === "estimada") estimated += 1;
    if (category === "sin_definir") undefinedEta += 1;
    if (category === "atrasada") delayed += 1;
    if (order.estimatedMonthDate?.startsWith(currentMonth)) thisMonth += 1;
  }

  return {
    total: orders.length,
    confirmed,
    estimated,
    undefinedEta,
    thisMonth,
    delayed,
    delivered,
  };
}
