/**
 * Medida logística positiva o null (acepta string/number desde formulario o JSON).
 */
export function positiveMeasureOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}
