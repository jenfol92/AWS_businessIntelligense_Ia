import type { FinancePlanningEvent } from "../types/planning.types";

export function partitionFinanceEventsByDate(events: FinancePlanningEvent[]) {
  return {
    pendingDateEvents: events.filter((event) => event.isPendingDate || !event.date),
    datedEvents: events.filter((event) => !event.isPendingDate && Boolean(event.date)),
  };
}
