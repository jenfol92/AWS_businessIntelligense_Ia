import type { InventoryRow } from "../types/inventory.types.ts";
import type {
  ResolvedChannelScope,
  ResolvedCountryScope,
} from "./inventoryScope.ts";
import { stockForChannelRow } from "./inventoryScope.ts";
import { isInventoryTimestampNotStale } from "./inventoryFreshnessPolicy.ts";

export type LatestFbaLedgerStock = {
  snapshotDate: string;
  stockSellable: number;
  stockTotal: number;
};

export type LatestFbaInventorySnapshotStock = {
  snapshotRunId: string;
  operationalPool: string;
  snapshotAt: string;
  fulfillableQuantity: number;
  reservedQuantity: number | null;
  inboundQuantity: number | null;
  unfulfillableQuantity: number | null;
  source: string;
};

export type InventarioPaisStockRow = {
  pais: string;
  stockFba: number;
  stockFbm: number;
  updatedAt: string | null;
};

export type OperationalStockFbaSource =
  | "fba_inventory_snapshot"
  | "country_inventory"
  /** Compatibilidad de presentaciÃ³n; el resolver canÃ³nico nunca lo elige. */
  | "ledger"
  | "none";

export type AmazonSyncJobStatus = {
  jobKey: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastRowsUpserted: number | null;
  nextRunHint: string | null;
};

export type OperationalStockSummary = {
  stockFbaApp: number;
  stockFbmApp: number;
  stockFbaAppByCountry: InventarioPaisStockRow[];
  stockFbaLatestLedger: number | null;
  stockFbaLatestLedgerDate: string | null;
  stockFbaLatestLedgerTotal: number | null;
  stockFbaLatestSnapshot: number | null;
  stockFbaLatestSnapshotAt: string | null;
  stockFbaLatestSnapshotSource: string | null;
  /** Máximo updated_at entre filas inventario_paises del producto. */
  stockFbaAppLatestUpdatedAt: string | null;
  stockFbaDiscrepancy: boolean;
  stockOperationalFba: number;
  stockOperationalFbaSource: OperationalStockFbaSource;
  stockOperationalFbm: number;
  stockOperationalTotal: number;
  discrepancyMessage: string | null;
  fbaInventorySyncStatus?: AmazonSyncJobStatus | null;
};

export type BuildOperationalStockOptions = {
  /** Hora de referencia inyectable para evaluar freshness. */
  now?: Date;
};

function sumInventarioFba(rows: InventoryRow[]): number {
  return rows.reduce((s, r) => s + Number(r.stock_fba ?? 0), 0);
}

function sumInventarioFbm(rows: InventoryRow[]): number {
  return rows.reduce((s, r) => s + Number(r.stock_fbm ?? 0), 0);
}

function latestInventarioPaisesUpdatedAt(rows: InventoryRow[]): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;

  for (const row of rows) {
    const updatedAt = row.updated_at;
    if (!updatedAt) continue;
    const ms = new Date(updatedAt).getTime();
    if (!Number.isFinite(ms) || ms <= latestMs) continue;
    latestMs = ms;
    latest = updatedAt;
  }

  return latest;
}

function ledgerSnapshotMs(snapshotDate: string): number {
  return new Date(`${snapshotDate.slice(0, 10)}T00:00:00Z`).getTime();
}

/** True si inventario_paises tiene al menos una fila para el producto. */
function hasCountryInventoryRows(rows: InventoryRow[]): boolean {
  return rows.length > 0;
}

/**
 * inventario_paises es más reciente que el snapshot ledger cuando
 * su updated_at máximo es posterior a la fecha del ledger.
 */
function isCountryInventoryNewerThanLedger(
  latestCountryUpdatedAt: string | null,
  ledgerDate: string | null,
): boolean {
  if (!latestCountryUpdatedAt || !ledgerDate) return false;

  const countryDay = latestCountryUpdatedAt.slice(0, 10);
  const ledgerDay = ledgerDate.slice(0, 10);
  if (countryDay > ledgerDay) return true;
  if (countryDay < ledgerDay) return false;

  const countryMs = new Date(latestCountryUpdatedAt).getTime();
  const ledgerMs = ledgerSnapshotMs(ledgerDate);
  return Number.isFinite(countryMs) && countryMs > ledgerMs;
}

function resolveOperationalFbaSource(params: {
  hasSnapshot: boolean;
  hasCountryRows: boolean;
}): OperationalStockFbaSource {
  const { hasSnapshot, hasCountryRows } = params;
  if (hasSnapshot) return "fba_inventory_snapshot";
  if (hasCountryRows) return "country_inventory";
  return "none";
}

function resolveOperationalFba(
  source: OperationalStockFbaSource,
  stockFbaLatestSnapshot: number | null,
  stockFbaApp: number,
  stockFbaLatestLedger: number | null,
): number {
  switch (source) {
    case "fba_inventory_snapshot":
      return stockFbaLatestSnapshot ?? 0;
    case "country_inventory":
      return stockFbaApp;
    default:
      return 0;
  }
}

function buildDiscrepancyMessage(
  stockFbaDiscrepancy: boolean,
  source: OperationalStockFbaSource,
  stockFbaLatestSnapshot: number | null,
  stockFbaApp: number,
  stockFbaLatestLedger: number | null,
): string | null {
  if (!stockFbaDiscrepancy) return null;

  if (source === "fba_inventory_snapshot" && stockFbaLatestSnapshot != null) {
    return `Se usa snapshot FBA operativo como fuente principal (${stockFbaLatestSnapshot} uds). FBA Country es distribuciÃ³n auxiliar y ledger queda como auditorÃ­a.`;
  }

  if (
    source === "country_inventory" &&
    stockFbaLatestLedger != null
  ) {
    return `La última lectura del ledger FBA indica ${stockFbaLatestLedger} uds, pero el stock por país actualizado indica ${stockFbaApp} uds. Se usa el stock por país como stock operativo.`;
  }

  if (source === "country_inventory") {
    return "La última lectura del ledger FBA no coincide con el stock por país. Se usa el stock por país como stock operativo porque es la fuente más reciente.";
  }

  if (source === "ledger" && stockFbaLatestLedger != null) {
    return `La última lectura del ledger FBA indica ${stockFbaLatestLedger} uds, pero el stock por país registrado indica ${stockFbaApp} uds. Se usa el ledger como stock operativo.`;
  }

  if (source === "ledger") {
    return "La última lectura del ledger FBA no coincide con el stock por país. Se usa el ledger como stock operativo porque es la fuente más reciente.";
  }

  return null;
}

export function buildOperationalStockSummary(
  inventoryRows: InventoryRow[],
  ledger: LatestFbaLedgerStock | null | undefined,
  snapshot: LatestFbaInventorySnapshotStock | null | undefined,
  options: BuildOperationalStockOptions = {},
): OperationalStockSummary {
  const now = options.now ?? new Date();
  const stockFbaApp = sumInventarioFba(inventoryRows);
  const stockFbmApp = sumInventarioFbm(inventoryRows);

  const stockFbaAppByCountry: InventarioPaisStockRow[] = inventoryRows
    .map((row) => ({
      pais: row.pais,
      stockFba: Number(row.stock_fba ?? 0),
      stockFbm: Number(row.stock_fbm ?? 0),
      updatedAt: row.updated_at ?? null,
    }))
    .sort((a, b) => a.pais.localeCompare(b.pais));

  const stockFbaLatestLedger = ledger?.stockSellable ?? null;
  const stockFbaLatestLedgerDate = ledger?.snapshotDate ?? null;
  const stockFbaLatestLedgerTotal = ledger?.stockTotal ?? null;
  const stockFbaLatestSnapshot = snapshot?.fulfillableQuantity ?? null;
  const stockFbaLatestSnapshotAt = snapshot?.snapshotAt ?? null;
  const stockFbaLatestSnapshotSource = snapshot?.source ?? null;
  const stockFbaAppLatestUpdatedAt = latestInventarioPaisesUpdatedAt(inventoryRows);

  const hasSnapshot =
    stockFbaLatestSnapshot != null && isInventoryTimestampNotStale(stockFbaLatestSnapshotAt, now);
  const hasLedger =
    stockFbaLatestLedger != null &&
    isInventoryTimestampNotStale(stockFbaLatestLedgerDate ? `${stockFbaLatestLedgerDate}T00:00:00Z` : null, now);
  const hasCountryRows =
    hasCountryInventoryRows(inventoryRows) && isInventoryTimestampNotStale(stockFbaAppLatestUpdatedAt, now);
  const countryNewerThanLedger = isCountryInventoryNewerThanLedger(
    stockFbaAppLatestUpdatedAt,
    stockFbaLatestLedgerDate,
  );

  const stockOperationalFbaSource = resolveOperationalFbaSource({
    hasSnapshot,
    hasCountryRows,
  });

  const stockOperationalFba = resolveOperationalFba(
    stockOperationalFbaSource,
    stockFbaLatestSnapshot,
    stockFbaApp,
    stockFbaLatestLedger,
  );
  const stockOperationalFbm = stockFbmApp;
  const stockOperationalTotal = stockOperationalFba + stockOperationalFbm;

  const stockFbaDiscrepancy =
    (hasSnapshot && hasCountryRows && Math.abs(stockFbaApp - stockFbaLatestSnapshot) > 0) ||
    (hasLedger && hasCountryRows && Math.abs(stockFbaApp - stockFbaLatestLedger) > 0);

  const discrepancyMessage = buildDiscrepancyMessage(
    stockFbaDiscrepancy,
    stockOperationalFbaSource,
    stockFbaLatestSnapshot,
    stockFbaApp,
    stockFbaLatestLedger,
  );

  return {
    stockFbaApp,
    stockFbmApp,
    stockFbaAppByCountry,
    stockFbaLatestLedger,
    stockFbaLatestLedgerDate,
    stockFbaLatestLedgerTotal,
    stockFbaLatestSnapshot,
    stockFbaLatestSnapshotAt,
    stockFbaLatestSnapshotSource,
    stockFbaAppLatestUpdatedAt,
    stockFbaDiscrepancy,
    stockOperationalFba,
    stockOperationalFbaSource,
    stockOperationalFbm,
    stockOperationalTotal,
    discrepancyMessage,
  };
}

/**
 * Stock de apertura para forecast/simulación según scope.
 * ALL/ALL y ALL+FBA usan stock operativo FBA resuelto (país o ledger según frescura).
 */
export function resolveOpeningStockForScope(
  inventoryRows: InventoryRow[],
  countryScope: ResolvedCountryScope,
  channelScope: ResolvedChannelScope,
  operational: OperationalStockSummary | null | undefined,
): number {
  const scopedRows =
    countryScope.countries == null
      ? inventoryRows
      : inventoryRows.filter((r) => countryScope.countries!.includes(r.pais));

  if (
    countryScope.filter === "ALL" &&
    channelScope.filter === "ALL" &&
    operational
  ) {
    return operational.stockOperationalTotal;
  }

  if (
    countryScope.filter === "ALL" &&
    channelScope.filter === "AMAZON_FBA" &&
    operational &&
    operational.stockOperationalFbaSource !== "none"
  ) {
    return operational.stockOperationalFba;
  }

  return scopedRows.reduce(
    (sum, row) => sum + stockForChannelRow(row, channelScope),
    0,
  );
}
