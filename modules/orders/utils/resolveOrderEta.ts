export function normalizeOrderDateField(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Prioridad ETA al confirmar:
 * 1. ETA guardada en la orden
 * 2. ETD + lead times
 * 3. Hoy + lead times (solo si no hay ETD)
 */
export function resolveOrderEtaForConfirm(params: {
  savedEta?: string | null;
  etd?: string | null;
  diasProduccion: number;
  diasTransito: number;
  baseDate?: Date;
}): string {
  const directEta = normalizeOrderDateField(params.savedEta);
  if (directEta) return directEta;

  const etd = normalizeOrderDateField(params.etd);
  const totalDays = Math.max(0, params.diasProduccion) + Math.max(0, params.diasTransito);

  if (etd) {
    return addDays(etd, totalDays);
  }

  const base = params.baseDate ?? new Date();
  const isoBase = base.toISOString().slice(0, 10);
  return addDays(isoBase, totalDays);
}
