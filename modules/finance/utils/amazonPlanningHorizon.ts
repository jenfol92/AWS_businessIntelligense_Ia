/** Fixed Amazon planning chart horizon; independent of general finance query.months. */
export const AMAZON_PLANNING_HORIZON_MONTH_COUNT = 12;

function addMonthsUtc(fromMonth: string, offset: number): string {
  const date = new Date(`${fromMonth}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

/** Exactly 12 consecutive YYYY-MM buckets starting at fromMonth. */
export function buildAmazonPlanningHorizonMonths(fromMonth: string): string[] {
  return Array.from({ length: AMAZON_PLANNING_HORIZON_MONTH_COUNT }, (_, index) =>
    addMonthsUtc(fromMonth, index),
  );
}
