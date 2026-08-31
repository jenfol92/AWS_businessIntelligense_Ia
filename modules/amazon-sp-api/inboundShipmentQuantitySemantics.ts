export type InboundItemQuantities = {
  expectedQty: number | null;
  shippedQty: number | null;
  receivedQty: number | null;
  locatedQty: number | null;
};

export type PersistedInboundQuantities = {
  expected: number | null;
  shipped: number | null;
  received: number | null;
  located: number | null;
};

/**
 * Repo schema (no live probe):
 * - cantidad_esperada is not in the original CREATE TABLE; repairs treat it as nullable.
 * - quantity_expected is proposed as int NULL.
 * - cantidad_enviada is int NOT NULL DEFAULT 0 — unknown shipped cannot be stored there.
 */
export const SCHEMA_ALLOWS_NULL_EXPECTED = true;
export const SCHEMA_CANTIDAD_ENVIADA_NOT_NULL_DEFAULT_ZERO = true;

/**
 * 0 means Amazon reported zero. null means this source did not supply the field.
 */
export function parseOptionalQuantity(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function inboundQuantityRowKey(shipmentId: string, sku: string): string {
  return `${shipmentId}::${sku}`;
}

export function resolveInboundItemQuantities(item: {
  expected_quantity: unknown;
  shipped_quantity: unknown;
  received_quantity: unknown;
  located_quantity: unknown;
}): InboundItemQuantities {
  return {
    expectedQty: parseOptionalQuantity(item.expected_quantity),
    shippedQty: parseOptionalQuantity(item.shipped_quantity),
    receivedQty: parseOptionalQuantity(item.received_quantity),
    locatedQty: parseOptionalQuantity(item.located_quantity),
  };
}

export function resolveInboundDiscrepancy(
  shippedQty: number | null,
  receivedQty: number | null,
): number | null {
  if (shippedQty == null || receivedQty == null) return null;
  return shippedQty - receivedQty;
}

/**
 * Unknown incoming values must not overwrite a known persisted quantity.
 * 0 is known evidence and is preserved; only null/undefined is unknown.
 */
export function preserveExistingInboundQuantities(
  incoming: PersistedInboundQuantities,
  existing: PersistedInboundQuantities | null,
): PersistedInboundQuantities {
  if (!existing) return incoming;
  return {
    expected: incoming.expected ?? existing.expected,
    shipped: incoming.shipped ?? existing.shipped,
    received: incoming.received ?? existing.received,
    located: incoming.located ?? existing.located,
  };
}

export function parseExistingAmazonEnviosQuantities(row: {
  cantidad_esperada?: unknown;
  cantidad_enviada?: unknown;
  cantidad_recibida?: unknown;
  cantidad_localizada?: unknown;
  quantity_expected?: unknown;
  quantity_shipped?: unknown;
  raw?: unknown;
}): PersistedInboundQuantities {
  const raw =
    row.raw && typeof row.raw === "object" && !Array.isArray(row.raw)
      ? (row.raw as Record<string, unknown>)
      : {};
  return {
    expected:
      parseOptionalQuantity(row.cantidad_esperada) ??
      parseOptionalQuantity(row.quantity_expected) ??
      parseOptionalQuantity(raw.quantity_expected),
    shipped:
      parseOptionalQuantity(raw.quantity_shipped) ??
      parseOptionalQuantity(row.quantity_shipped) ??
      parseOptionalQuantity(row.cantidad_enviada),
    received:
      parseOptionalQuantity(row.cantidad_recibida) ??
      parseOptionalQuantity(raw.quantity_received),
    located:
      parseOptionalQuantity(row.cantidad_localizada) ??
      parseOptionalQuantity(raw.quantity_located),
  };
}

/**
 * cantidad_enviada is NOT NULL DEFAULT 0. Omitting the key avoids inventing 0
 * on update; new inserts still receive the column default.
 */
export function omitUnknownCantidadEnviada<T extends { cantidad_enviada?: number | null }>(
  row: T,
): T {
  if (row.cantidad_enviada != null) return row;
  const { cantidad_enviada: _omit, ...rest } = row;
  return rest as T;
}
