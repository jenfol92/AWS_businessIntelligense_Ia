export type InclusiveDateWindow = {
  fromDate: string;
  toDate: string;
};

export function buildInclusiveDateWindow(
  toDate: string,
  days: number,
): InclusiveDateWindow {
  const safeDays = Math.max(1, Math.trunc(days));
  const end = new Date(`${toDate}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) {
    throw new Error(`Invalid inclusive window end date: ${toDate}`);
  }
  end.setUTCDate(end.getUTCDate() - (safeDays - 1));
  return {
    fromDate: end.toISOString().slice(0, 10),
    toDate,
  };
}

export function isDateInInclusiveWindow(
  date: string,
  window: InclusiveDateWindow,
): boolean {
  return date >= window.fromDate && date <= window.toDate;
}
