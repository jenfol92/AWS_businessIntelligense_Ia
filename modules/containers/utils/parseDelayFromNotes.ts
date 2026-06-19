/**
 * Extrae el último retraso registrado en las notas del contenedor.
 * Busca líneas con el patrón: [YYYY-MM-DD HH:mm] RETRASO: +Xd. Motivo: ...
 *
 * @returns { dias, motivo } del último retraso encontrado, o null si no hay ninguno.
 */
export function parseDelayFromNotes(
  notas: string | null,
): { dias: number; motivo: string } | null {
  if (!notas) return null;
  const lines   = notas.split("\n").reverse();
  const pattern = /\[[\d\-/ :,]+\]\s*RETRASO:\s*\+(\d+)d[ías.]*\s*Motivo:\s*(.*)$/i;
  for (const line of lines) {
    const m = pattern.exec(line.trim());
    if (m) {
      return { dias: parseInt(m[1], 10), motivo: m[2]?.trim() ?? "" };
    }
  }
  return null;
}
