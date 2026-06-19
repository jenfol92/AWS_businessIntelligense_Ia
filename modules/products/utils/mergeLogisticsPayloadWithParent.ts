/**
 * Rellena huecos del payload logístico del hijo desde el padre.
 * Nunca copia cubicaje_unitario_m3 (GENERATED en BD).
 */

const INHERITABLE_MEASURES = [
  "largo_cm",
  "ancho_cm",
  "alto_cm",
  "peso_kg_bruto",
] as const;

const INHERITABLE_COUNTS = ["unidades_por_caja", "pedido_minimo_unidades"] as const;

function isPositiveMeasure(value: unknown): boolean {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function isCountMissing(value: unknown): boolean {
  return value === null || value === undefined;
}

function isEanMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  return String(value).trim() === "";
}

export function mergeLogisticsPayloadWithParent(
  childPayload: Record<string, unknown>,
  parentLogistics: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...childPayload };

  for (const key of INHERITABLE_MEASURES) {
    if (!isPositiveMeasure(out[key]) && isPositiveMeasure(parentLogistics[key])) {
      out[key] = parentLogistics[key];
    }
  }

  for (const key of INHERITABLE_COUNTS) {
    if (isCountMissing(out[key]) && !isCountMissing(parentLogistics[key])) {
      out[key] = parentLogistics[key];
    }
  }

  // EAN del hijo tiene prioridad; solo heredar si el hijo no tiene uno propio.
  if (isEanMissing(out.ean_upc) && !isEanMissing(parentLogistics.ean_upc)) {
    out.ean_upc = parentLogistics.ean_upc;
  }

  delete out.cubicaje_unitario_m3;

  return out;
}
