/** Normaliza un marketplace/país a código corto (stub). */
export function countryToIso(value: unknown): string {
  if (value == null) return "";
  const s = String(value).trim().toUpperCase();
  if (s.length <= 2) return s;
  return s.slice(0, 2);
}
