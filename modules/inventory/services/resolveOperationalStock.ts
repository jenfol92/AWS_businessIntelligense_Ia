import type { InventoryRow } from "../types/inventory.types";
import type {
  ResolvedChannelScope,
  ResolvedCountryScope,
} from "./inventoryScope";
import { stockForChannelRow } from "./inventoryScope";

export type LatestFbaLedgerStock = {
  snapshotDate: string;
  stockSellable: number;
  stockTotal: number;
};

export type InventarioPaisStockRow = {
  pais: string;
  stockFba: number;
  stockFbm: number;
  updatedAt: string | null;
};

export type OperationalStockSummary = {
  stockFbaApp: number;
  stockFbmApp: number;
  stockFbaAppByCountry: InventarioPaisStockRow[];
  stockFbaLatestLedger: number | null;
  stockFbaLatestLedgerDate: string | null;
  stockFbaLatestLedgerTotal: number | null;
  stockFbaDiscrepancy: boolean;
  stockOperationalFba: number;
  stockOperationalFbm: number;
  stockOperationalTotal: number;
  discrepancyMessage: string | null;
};

function sumInventarioFba(rows: InventoryRow[]): number {
  return rows.reduce((s, r) => s + Number(r.stock_fba ?? 0), 0);
}

function sumInventarioFbm(rows: InventoryRow[]): number {
  return rows.reduce((s, r) => s + Number(r.stock_fbm ?? 0), 0);
}

export function buildOperationalStockSummary(
  inventoryRows: InventoryRow[],
  ledger: LatestFbaLedgerStock | null | undefined,
): OperationalStockSummary {
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

  const hasLedger = stockFbaLatestLedger != null && stockFbaLatestLedgerDate != null;
  const stockFbaDiscrepancy =
    hasLedger && Math.abs(stockFbaApp - stockFbaLatestLedger) > 0;

  const stockOperationalFba = hasLedger ? stockFbaLatestLedger : stockFbaApp;
  const stockOperationalFbm = stockFbmApp;
  const stockOperationalTotal = stockOperationalFba + stockOperationalFbm;

  const discrepancyMessage = stockFbaDiscrepancy
    ? "El stock FBA importado por ledger no coincide con el stock por país registrado en la app."
    : null;

  return {
    stockFbaApp,
    stockFbmApp,
    stockFbaAppByCountry,
    stockFbaLatestLedger,
    stockFbaLatestLedgerDate,
    stockFbaLatestLedgerTotal,
    stockFbaDiscrepancy,
    stockOperationalFba,
    stockOperationalFbm,
    stockOperationalTotal,
    discrepancyMessage,
  };
}

/**
 * Stock de apertura para forecast/simulación según scope.
 * ALL/ALL y ALL+FBA usan ledger FBA cuando existe; por país sigue inventario_paises.
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
    operational?.stockFbaLatestLedger != null
  ) {
    return operational.stockOperationalFba;
  }

  return scopedRows.reduce(
    (sum, row) => sum + stockForChannelRow(row, channelScope),
    0,
  );
}
