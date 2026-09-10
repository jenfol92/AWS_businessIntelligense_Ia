/** Commercial monthly estimate, independent of an unconfirmed bank receipt date. */
export function monthlyAmazonEstimate(rows: Record<string, unknown>[], month: string): number | null {
  const forecasts = rows.filter(row => String(row.economic_state ?? '').toUpperCase() === 'FUTURE'
    && !['received', 'cancelled'].includes(String(row.status ?? '').toLowerCase())
    && String(row.cycle_start ?? row.forecast_date ?? '').slice(0, 7) === month);
  if (!forecasts.length) return null;
  let total = 0;
  for (const row of forecasts) {
    const raw = row.amount_eur;
    if (raw == null || raw === '' || !Number.isFinite(Number(raw))) return null;
    total += Number(raw);
  }
  return Math.round(total * 100) / 100;
}
