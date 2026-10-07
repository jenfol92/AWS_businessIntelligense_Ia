// modules/inventory/services/ledgerCountryStock.ts
//
// Stock FBA por país a partir de las filas del Inventory Ledger
// (amazon_fba_inventory_ledger_daily), replicando la vista de Seller Central:
//  - último día disponible por producto;
//  - una fila por FNSKU + ASIN + ubicación + disposición (si la misma fila llegó
//    por dos importaciones distintas, se queda la más reciente; no se suma dos veces);
//  - "vendible" = SELLABLE de producto nuevo. Las unidades Grade & Resell
//    (seller SKU "amzn.gr.…" o condición distinta de nuevo) se separan;
//  - en tránsito entre almacenes se informa aparte (no suma al stock del país).
// Función pura: sin acceso a BD, para poder probarla.

import type { FbaInventoryCountryStockRow } from "../types/inventory.types";

export type LedgerRowInput = {
  coverage_valid?: boolean;
  producto_id?: string | null;
  sku_original?: string | null;
  fnsku?: string | null;
  asin?: string | null;
  snapshot_date?: string | null;
  disposition?: string | null;
  condition_type?: string | null;
  ending_warehouse_balance?: number | null;
  in_transit_between_warehouses?: number | null;
  location?: string | null;
  location_country?: string | null;
  physical_country?: string | null;
  updated_at?: string | null;
};

const STALE_AFTER_DAYS = 3;

function upper(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/** Código de país físico a partir de la ubicación del ledger. */
export function ledgerRowCountry(row: LedgerRowInput): string {
  if (row.coverage_valid !== undefined && !row.physical_country) return "UNKNOWN_LOCATION";
  for (const candidate of [row.physical_country, row.location_country, row.location]) {
    const code = upper(candidate);
    if (code === "UK") return "GB";
    if (/^[A-Z]{2}$/.test(code)) return code;
  }
  return "UNKNOWN_LOCATION";
}

/** Unidades Grade & Resell / no nuevas (no cuentan como stock vendible principal). */
export function isResaleLedgerRow(row: LedgerRowInput): boolean {
  if (String(row.sku_original ?? "").trim().toLowerCase().startsWith("amzn.gr.")) return true;
  const condition = upper(row.condition_type);
  return condition !== "" && condition !== "NEWITEM" && condition !== "NEW" && condition !== "UNKNOWN";
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

export function aggregateLatestLedgerByCountry(
  rows: LedgerRowInput[],
  todayIso: string,
): Map<string, FbaInventoryCountryStockRow[]> {
  // 1) Último día por producto.
  const latestByProduct = new Map<string, string>();
  for (const row of rows) {
    const productId = row.producto_id;
    const date = String(row.snapshot_date ?? "").slice(0, 10);
    if (!productId || !date) continue;
    const current = latestByProduct.get(productId);
    if (!current || date > current) latestByProduct.set(productId, date);
  }

  // 2) Deduplicar filas del último día (misma fila física importada por varias fuentes).
  const deduped = new Map<string, LedgerRowInput>();
  for (const row of rows) {
    const productId = row.producto_id;
    const date = String(row.snapshot_date ?? "").slice(0, 10);
    if (!productId || date !== latestByProduct.get(productId)) continue;
    const key = [
      productId,
      upper(row.fnsku),
      upper(row.asin),
      upper(row.location) || ledgerRowCountry(row),
      upper(row.disposition),
      ["NEW","NEWITEM"].includes(upper(row.condition_type)) ? "NEW" : upper(row.condition_type) || "UNKNOWN",
    ].join("|");
    const previous = deduped.get(key);
    if (!previous || String(row.updated_at ?? "") > String(previous.updated_at ?? "")) {
      deduped.set(key, row);
    }
  }

  // 3) Totales por producto y país.
  type Acc = FbaInventoryCountryStockRow & { byDisposition: Map<string, number> };
  const acc = new Map<string, Acc>();
  for (const row of Array.from(deduped.values())) {
    const productId = row.producto_id as string;
    const date = latestByProduct.get(productId) as string;
    const pais = ledgerRowCountry(row);
    const key = `${productId}|${pais}`;
    const balance = Number(row.ending_warehouse_balance ?? 0) || 0;
    const inTransit = Number(row.in_transit_between_warehouses ?? 0) || 0;
    const disposition = upper(row.disposition) || "UNKNOWN";
    const staleDays = daysBetween(date, todayIso);

    const item =
      acc.get(key) ??
      ({
        productoId: productId,
        pais,
        snapshotDate: date,
        lastImportedAt: null,
        stockSellable: 0,
        stockUnsellable: 0,
        stockTotal: 0,
        stockResaleSellable: 0,
        stockInTransit: 0,
        stockUnknownConditionSellable: 0,
        coverageValid: true,
        isStale: staleDays > STALE_AFTER_DAYS,
        staleDays,
        dispositions: [],
        byDisposition: new Map<string, number>(),
      } as Acc);

    if (disposition === "SELLABLE") {
      if (isResaleLedgerRow(row)) item.stockResaleSellable = (item.stockResaleSellable ?? 0) + balance;
      else if (["NEW","NEWITEM"].includes(upper(row.condition_type))) item.stockSellable += balance;
      else item.stockUnknownConditionSellable = (item.stockUnknownConditionSellable ?? 0) + balance;
    } else {
      item.stockUnsellable += balance;
    }
    item.coverageValid = item.coverageValid && row.coverage_valid === true;
    item.stockTotal += balance;
    item.stockInTransit = (item.stockInTransit ?? 0) + inTransit;
    item.byDisposition.set(disposition, (item.byDisposition.get(disposition) ?? 0) + balance);
    if (row.updated_at && (!item.lastImportedAt || row.updated_at > item.lastImportedAt)) {
      item.lastImportedAt = row.updated_at;
    }
    acc.set(key, item);
  }

  const result = new Map<string, FbaInventoryCountryStockRow[]>();
  for (const item of Array.from(acc.values())) {
    const { byDisposition, ...rest } = item;
    const row: FbaInventoryCountryStockRow = {
      ...rest,
      dispositions: Array.from(byDisposition.entries())
        .map(([disposition, stock]) => ({ disposition, stock }))
        .sort((a, b) => (a.disposition === "SELLABLE" ? -1 : b.disposition === "SELLABLE" ? 1 : b.stock - a.stock)),
    };
    // An explicit zero row is evidence; an absent row is not zero.
    const list = result.get(row.productoId) ?? [];
    list.push(row);
    result.set(row.productoId, list);
  }
  for (const list of Array.from(result.values())) list.sort((a, b) => a.pais.localeCompare(b.pais));
  return result;
}
