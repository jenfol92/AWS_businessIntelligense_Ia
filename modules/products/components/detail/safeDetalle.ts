/** Narrow `unknown` producto/detalle/proveedor from ProductDetailResponse. */

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function strField(
  obj: Record<string, unknown> | null,
  key: string,
): string | null {
  if (!obj) return null;
  const v = obj[key];
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export function imageUrlFromDetalle(detalle: unknown): string | null {
  const r = asRecord(detalle);
  if (!r) return null;
  return strField(r, "imagen_url") ?? strField(r, "imagenUrl");
}
