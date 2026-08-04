export function addCivilDays(isoDate: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !Number.isInteger(days)) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== isoDate) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function nextSuggestedDueDate(
  dispositionDate: string,
  cycleDays: number | null,
  currentDueDate: string,
  wasManuallyEdited: boolean,
): string {
  if (wasManuallyEdited || cycleDays == null || cycleDays <= 0) return currentDueDate;
  return addCivilDays(dispositionDate, cycleDays);
}
