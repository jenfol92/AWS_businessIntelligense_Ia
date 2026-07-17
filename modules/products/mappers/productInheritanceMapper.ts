// modules/products/mappers/productInheritanceMapper.ts
//
// Reglas de fusión padre → hijo para la ficha de producto (variantes).
// Solo transformación en memoria: no SQL, no rutas.

/** Núcleo mínimo de `productos` usado en herencia. */
export type ProductoCoreForInheritance = {
  id: string;
  proveedor_id: string | null;
  parent_id: string | null;
  especificaciones: unknown;
};

export type ProductoDetalleRow = {
  id?: string;
  producto_id?: string;
  descripcion_tecnica?: string | null;
  imagen_url?: string | null;
  categoria_id?: string | null;
  categoria?: string | null;
  marca?: string | null;
  color?: string | null;
  created_at?: string | null;
};

type CostRowLike = {
  costo_unitario_total_eur?: unknown;
};

export type CosteUnitarioTotalEfectivo = {
  valueEur: number | null;
  source: "own" | "parent" | "none";
  inheritedFromParent: boolean;
  inheritanceRequested: boolean;
  parentProductId: string | null;
};

function isEmptyish(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "object" && !Array.isArray(value))
    return Object.keys(value as object).length === 0;
  return false;
}

function isEspecificacionesVacias(spec: unknown): boolean {
  if (spec === null || spec === undefined) return true;
  if (typeof spec !== "object" || Array.isArray(spec)) return false;
  return Object.keys(spec as object).length === 0;
}

/**
 * 1) producto.especificaciones: si hijo vacío/null/{}, usar JSON del padre.
 */
export function mergeProductoEspecificaciones(
  producto: ProductoCoreForInheritance,
  parent: ProductoCoreForInheritance | null
): ProductoCoreForInheritance {
  if (!parent || !isEspecificacionesVacias(producto.especificaciones)) {
    return producto;
  }
  return {
    ...producto,
    especificaciones: parent.especificaciones,
  };
}

const DETALLE_HEREDABLE: (keyof ProductoDetalleRow)[] = [
  "descripcion_tecnica",
  "categoria_id",
  "categoria",
  "marca",
];

/**
 * 2) detalle: solo descripcion_tecnica, categoria_id, categoria, marca si vacíos en hijo.
 *    Nunca imagen_url ni color desde padre.
 */
export function mergeDetalleConPadre(
  detalleHijo: ProductoDetalleRow | null,
  detallePadre: ProductoDetalleRow | null,
  hijoProductId: string
): ProductoDetalleRow | null {
  if (!detallePadre) return detalleHijo;

  const base: ProductoDetalleRow = detalleHijo
    ? { ...detalleHijo }
    : { producto_id: hijoProductId };

  for (const key of DETALLE_HEREDABLE) {
    if (!isEmptyish(base[key])) continue;
    const vPad = detallePadre[key];
    if (!isEmptyish(vPad)) base[key] = vPad;
  }

  return base;
}

const METADATA_KEYS_SKIP_MERGE = new Set([
  "id",
  "producto_id",
  "created_at",
]);

/**
 * 3–4) logistica / fichaTecnica: hijo sin fila → clon padre con producto_id del hijo;
 *       hijo con fila → rellenar solo huecos desde padre (no tocar id/producto_id/created_at).
 */
export function mergeRegistroHijoPadre<T extends Record<string, unknown>>(
  hijo: T | null,
  padre: T | null,
  hijoProductId: string
): T | null {
  if (!padre) return hijo;
  if (!hijo) {
    const clon = { ...padre } as Record<string, unknown>;
    delete clon.id;
    clon.producto_id = hijoProductId;
    return clon as T;
  }

  const out = { ...hijo } as Record<string, unknown>;
  for (const key of Object.keys(padre)) {
    if (METADATA_KEYS_SKIP_MERGE.has(key)) continue;
    if (!isEmptyish(out[key])) continue;
    const v = (padre as Record<string, unknown>)[key];
    if (!isEmptyish(v)) out[key] = v;
  }
  return out as T;
}

/**
 * 5) proveedor_id efectivo: hijo null → padre; si no hay, null.
 */
export function resolveProveedorIdEfectivo(
  proveedorIdHijo: string | null | undefined,
  proveedorIdPadre: string | null | undefined
): string | null {
  if (proveedorIdHijo != null && String(proveedorIdHijo).trim() !== "") {
    return String(proveedorIdHijo);
  }
  if (proveedorIdPadre != null && String(proveedorIdPadre).trim() !== "") {
    return String(proveedorIdPadre);
  }
  return null;
}

function costeVistaVacia(row: unknown): boolean {
  if (row === null || row === undefined) return true;
  if (typeof row !== "object") return true;
  const o = row as Record<string, unknown>;
  const keys = Object.keys(o).filter(
    (k) => k !== "id" && k !== "producto_id"
  );
  if (keys.length === 0) return true;
  return keys.every((k) => isEmptyish(o[k]));
}

function positiveNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function costoUnitarioTotalFrom(
  costeActual: unknown,
  costos: unknown[],
): number | null {
  const fromCurrent = positiveNumber(
    (costeActual as CostRowLike | null | undefined)?.costo_unitario_total_eur,
  );
  if (fromCurrent != null) return fromCurrent;

  const latest = Array.isArray(costos) ? (costos[0] as CostRowLike | undefined) : undefined;
  return positiveNumber(latest?.costo_unitario_total_eur);
}

export function resolveCosteUnitarioTotalEfectivo(params: {
  producto: Record<string, unknown>;
  parentId: string | null;
  costos: unknown[];
  costeActual: unknown;
  parentCostos: unknown[];
  parentCosteActual: unknown;
}): CosteUnitarioTotalEfectivo {
  const ownValue = costoUnitarioTotalFrom(params.costeActual, params.costos);
  return {
    valueEur: ownValue,
    source: ownValue != null ? "own" : "none",
    inheritedFromParent: false,
    inheritanceRequested: false,
    parentProductId: params.parentId,
  };
}

/**
 * 6) costes: lista vacía en hijo → lista del padre (copia superficial).
 *    Vistas costeActual / costeMedio: si hijo “vacío”, usar padre.
 */
export function mergeCostosLista(
  costosHijo: unknown[],
  costosPadre: unknown[],
  forceParent = false,
): unknown[] {
  if (forceParent) {
    return Array.isArray(costosPadre) ? [...costosPadre] : [];
  }
  if (!Array.isArray(costosHijo) || costosHijo.length === 0) {
    return Array.isArray(costosPadre) ? [...costosPadre] : [];
  }
  return costosHijo;
}

export function mergeCosteVista(
  costeHijo: unknown,
  costePadre: unknown,
  forceParent = false,
): unknown {
  if (forceParent) return costePadre ?? null;
  if (!costeVistaVacia(costeHijo)) return costeHijo;
  return costePadre ?? null;
}

/**
 * 7) documentos: sin relaciones propias → checklist del padre (copia superficial de filas).
 */
export function mergeDocumentosLista(
  docsHijo: unknown[],
  docsPadre: unknown[]
): unknown[] {
  if (!Array.isArray(docsHijo) || docsHijo.length === 0) {
    return Array.isArray(docsPadre) ? [...docsPadre] : [];
  }
  return docsHijo;
}
