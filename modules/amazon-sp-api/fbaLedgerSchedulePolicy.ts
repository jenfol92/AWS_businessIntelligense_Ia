export const FBA_LEDGER_DAILY_FREQUENCY_MINUTES = 24 * 60;
export const FBA_LEDGER_SCHEDULE_MARKETPLACE_COUNTRY = "EU";
export const FBA_LEDGER_SCHEDULE_MARKETPLACE_ID = null;
export const FBA_LEDGER_PHYSICAL_STALE_AFTER_HOURS = 72;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function lastCompleteFbaLedgerUtcDay(now = new Date()): string {
  const day = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  day.setUTCDate(day.getUTCDate() - 1);
  return isoDate(day);
}

export function fbaLedgerUtcDayBounds(date: string): {
  dataStartTime: string;
  dataEndTime: string;
} {
  return {
    dataStartTime: `${date}T00:00:00Z`,
    dataEndTime: `${date}T23:59:59Z`,
  };
}
