export function normalizeDateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

export function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

export function monthKeyFromIso(iso: string): string {
  return iso.slice(0, 7);
}

export function isEtaOnOrAfterToday(eta: string | null | undefined): boolean {
  const etaDate = normalizeDateOnly(eta);
  if (!etaDate) return false;
  return etaDate >= todayDateOnly();
}
