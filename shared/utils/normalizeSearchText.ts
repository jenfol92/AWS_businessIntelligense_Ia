// shared/utils/normalizeSearchText.ts
//
// Normalización de texto para búsquedas tolerantes a tildes y separadores.

/**
 * Normaliza texto para comparación de búsqueda:
 * minúsculas, sin diacríticos, separadores → espacio, espacios compactados.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Versión compacta sin espacios ni separadores (SKU, EAN, códigos).
 */
export function compactSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gi, "");
}

/**
 * Comprueba si `query` coincide con alguno de los campos normalizados.
 * Soporta coincidencia por tokens (nombre) y por cadena compacta (SKU/EAN).
 */
export function matchesNormalizedSearch(
  query: string,
  fields: Array<string | null | undefined>,
): boolean {
  const qNorm = normalizeSearchText(query);
  const qCompact = compactSearchText(query);

  if (!qNorm && !qCompact) return true;

  const tokens = qNorm.split(" ").filter(Boolean);
  const haystackNorm = fields
    .filter((field): field is string => Boolean(field?.trim()))
    .map((field) => normalizeSearchText(field))
    .join(" ");
  const haystackCompact = fields
    .filter((field): field is string => Boolean(field?.trim()))
    .map((field) => compactSearchText(field))
    .join("");

  if (qCompact.length >= 2 && haystackCompact.includes(qCompact)) {
    return true;
  }

  if (tokens.length === 0) return false;

  return tokens.every((token) => haystackNorm.includes(token));
}
