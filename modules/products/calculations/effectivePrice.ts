// modules/products/calculations/effectivePrice.ts
//
// Lógica pura de precio efectivo (sin Supabase). Alineada con:
// - RPC public.get_effective_price (herencia padre/hijo, vigencia, canal/país)
// - Selección en memoria sobre filas de producto_precios si la RPC no devuelve precio usable.

/** Fila mínima de `producto_precios` para selección en memoria. */
export type ProductPriceRow = {
  pais_code: string | null;
  channel: string | null;
  precio: unknown;
  price_type: string | null;
  valid_from: string | null;
  valid_to: string | null;
  currency?: string | null;
};

export type EffectivePriceRpcAttempt = {
  value: number | null;
  /** true si hubo error de invocación (red, SQL, firma); false si respuesta válida aunque valor sea null */
  failed: boolean;
};

export type EffectivePriceInput = {
  /** Fecha vigencia ISO YYYY-MM-DD (UTC fecha). */
  asOfDate: string;
  /** Valor de filtro global (`ALL` o código país). */
  paisQuery: string;
  /** `ALL` | `FBA` | `FBM` (como en query string del dashboard). */
  canalQuery: string;
  productId: string;
  parentId: string | null;
  /** Valor crudo de `productos.heredar_precio`; null/undefined hereda como true (COALESCE en BD). */
  heredarPrecio: boolean | null | undefined;
  rpcThree: EffectivePriceRpcAttempt;
  /** Intento con RPC `get_effective_price(p_producto_id)` (firma reducida en BD). */
  rpcProductIdOnly: EffectivePriceRpcAttempt;
  /** Filas de `producto_precios` del producto objetivo del fallback (padre si hereda precio, si no el hijo). */
  priceRows: ReadonlyArray<ProductPriceRow>;
  /** Moneda por defecto si ninguna fila aporta `currency`. */
  defaultCurrency?: string;
};

export type EffectivePriceSource =
  | "rpc"
  | "rpc_single_arg"
  | "producto_precios"
  | "none";

export type EffectivePriceResult = {
  precioVentaBase: number | null;
  currency: string;
  source: EffectivePriceSource;
  /** El precio aplicaría lista del padre (heredar_precio efectivo y existía parent_id). */
  inherited: boolean;
  /** false solo si el precio final provino de la RPC con 3 argumentos sin fallo. */
  usedFallback: boolean;
};

export function resolveCatalogChannelForEffectivePrice(
  canalQuery: string,
  paisQuery: string,
): string {
  const canal = canalQuery.trim().toUpperCase();
  if (canal === "FBA") return "AMAZON_FBA";
  if (canal === "FBM") return "AMAZON_FBM";
  const pais = paisQuery.trim().toUpperCase();
  return pais === "ES" ? "AMAZON_FBM" : "AMAZON_FBA";
}

/** País enviado a la RPC: null si ALL (la RPC elige mejor candidato). */
export function effectivePriceRpcPaisCode(paisQuery: string): string | null {
  const p = paisQuery.trim().toUpperCase();
  return p === "" || p === "ALL" ? null : p;
}

export function coalesceHeredarPrecio(
  value: boolean | null | undefined,
): boolean {
  return value !== false;
}

/**
 * Producto cuyas filas de `producto_precios` se usan en el fallback en memoria:
 * padre si el hijo hereda precio; en caso contrario el propio producto.
 */
export function effectivePriceFallbackTargetProductId(input: {
  productId: string;
  parentId: string | null;
  heredarPrecio: boolean | null | undefined;
}): string {
  const inherits =
    input.parentId != null && coalesceHeredarPrecio(input.heredarPrecio);
  if (inherits && input.parentId != null) return input.parentId;
  return input.productId;
}

export function effectivePriceInheritedFlag(input: {
  parentId: string | null;
  heredarPrecio: boolean | null | undefined;
}): boolean {
  return (
    input.parentId != null && coalesceHeredarPrecio(input.heredarPrecio)
  );
}

function normalizeRowChannel(raw: string | null | undefined): string {
  let v = (raw ?? "").toUpperCase().trim();
  if (v === "FBA") return "AMAZON_FBA";
  if (v === "FBM") return "AMAZON_FBM";
  return v;
}

function priceTypePriority(t: string | null | undefined): number {
  if (t === "PROMO") return 2;
  if (t === "GENERAL") return 1;
  return 0;
}

function parsePositivePrice(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function isRowVigente(
  row: ProductPriceRow,
  asOfDate: string,
): boolean {
  if (row.valid_from != null && row.valid_from !== "") {
    if (row.valid_from > asOfDate) return false;
  }
  if (row.valid_to != null && row.valid_to !== "") {
    if (row.valid_to < asOfDate) return false;
  }
  return true;
}

/**
 * Fallback cuando la RPC no aplica: vigentes por fecha, prioriza canal efectivo si hay filas,
 * orden PROMO > GENERAL > resto y valid_from desc.
 */
export function pickEffectivePriceFromProductoPreciosRows(
  rows: ReadonlyArray<ProductPriceRow>,
  effectiveChannel: string,
  asOfDate: string,
): { precioVentaBase: number | null; currency: string | null } {
  const vigentes = rows.filter((r) => isRowVigente(r, asOfDate));
  const withNorm = vigentes.map((r) => ({
    row: r,
    ch: normalizeRowChannel(r.channel),
  }));

  const byChannel = withNorm.filter((x) => x.ch === effectiveChannel);
  const candidatos = byChannel.length > 0 ? byChannel : withNorm;

  const sorted = [...candidatos].sort((a, b) => {
    const pa = priceTypePriority(a.row.price_type);
    const pb = priceTypePriority(b.row.price_type);
    if (pa !== pb) return pb - pa;
    const da = a.row.valid_from ?? "";
    const db = b.row.valid_from ?? "";
    return db.localeCompare(da);
  });

  const chosen = sorted[0]?.row;
  if (!chosen) {
    return { precioVentaBase: null, currency: null };
  }

  const amount = parsePositivePrice(chosen.precio);
  const cur =
    chosen.currency != null && String(chosen.currency).trim() !== ""
      ? String(chosen.currency).trim()
      : null;

  return { precioVentaBase: amount, currency: cur };
}

export function resolveEffectivePrice(
  input: EffectivePriceInput,
): EffectivePriceResult {
  const defaultCurrency = input.defaultCurrency ?? "EUR";
  const inherited = effectivePriceInheritedFlag({
    parentId: input.parentId,
    heredarPrecio: input.heredarPrecio,
  });

  const channel = resolveCatalogChannelForEffectivePrice(
    input.canalQuery,
    input.paisQuery,
  );

  if (
    !input.rpcThree.failed &&
    input.rpcThree.value != null &&
    input.rpcThree.value > 0
  ) {
    return {
      precioVentaBase: input.rpcThree.value,
      currency: defaultCurrency,
      source: "rpc",
      inherited,
      usedFallback: false,
    };
  }

  if (
    !input.rpcProductIdOnly.failed &&
    input.rpcProductIdOnly.value != null &&
    input.rpcProductIdOnly.value > 0
  ) {
    return {
      precioVentaBase: input.rpcProductIdOnly.value,
      currency: defaultCurrency,
      source: "rpc_single_arg",
      inherited,
      usedFallback: true,
    };
  }

  const picked = pickEffectivePriceFromProductoPreciosRows(
    input.priceRows,
    channel,
    input.asOfDate,
  );

  if (picked.precioVentaBase != null && picked.precioVentaBase > 0) {
    return {
      precioVentaBase: picked.precioVentaBase,
      currency: picked.currency ?? defaultCurrency,
      source: "producto_precios",
      inherited,
      usedFallback: true,
    };
  }

  return {
    precioVentaBase: null,
    currency: defaultCurrency,
    source: "none",
    inherited,
    usedFallback: true,
  };
}
