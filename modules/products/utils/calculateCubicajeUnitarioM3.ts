/**
 * CBM unitario (m³) a partir de dimensiones en centímetros.
 * Fórmula: (largo × ancho × alto) / 1_000_000
 */
export function calculateCubicajeUnitarioM3(
  largoCm: unknown,
  anchoCm: unknown,
  altoCm: unknown,
): number | null {
  const largo = Number(largoCm);
  const ancho = Number(anchoCm);
  const alto = Number(altoCm);

  if (!Number.isFinite(largo) || !Number.isFinite(ancho) || !Number.isFinite(alto)) {
    return null;
  }
  if (largo <= 0 || ancho <= 0 || alto <= 0) {
    return null;
  }

  return Number(((largo * ancho * alto) / 1_000_000).toFixed(6));
}
