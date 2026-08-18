import {
  fetchAmazonSyncJobStatuses,
  fetchSalesUnitsLastDays,
  fetchPreviousYearMonthlySalesBatch,
} from "../repositories/inventoryRepository";
import type {
  InventoryDiagnosticsResponse,
  InventoryProductDiagnostics,
  ProductBaseRow,
} from "../types/inventory.types";
import {
  loadInventoryContext,
  loadInventoryContextForProduct,
} from "./loadInventoryContext";

export type InventoryDiagnosticsParams = {
  productId?: string | null;
  limit?: number | null;
  q?: string | null;
  onlyMissing?: boolean;
};

const SYNC_JOB_KEYS = [
  "amazon_inventory_canonical",
  "amazon_fba_inventory_snapshot",
  "amazon_fba_sales_daily",
  "amazon_fba_ledger_daily",
  "amazon_inbound_shipments_sync",
];

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function productMatchesQuery(product: ProductBaseRow, q: string): boolean {
  const text = q.trim().toLowerCase();
  if (!text) return true;
  return (
    product.sku.toLowerCase().includes(text) ||
    String(product.nombre ?? "").toLowerCase().includes(text)
  );
}

function differenceSeverity(params: {
  snapshotUnits: number | null;
  legacyUnits: number;
}): "ok" | "warning" | "critical" {
  if (params.snapshotUnits == null) return "ok";
  const diff = Math.abs(params.snapshotUnits - params.legacyUnits);
  if (diff === 0) return "ok";
  const base = Math.max(Math.abs(params.snapshotUnits), Math.abs(params.legacyUnits), 1);
  if (diff >= 100 || diff / base > 0.2) return "critical";
  return "warning";
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value);
}

export async function buildInventoryDiagnostics(
  params: InventoryDiagnosticsParams = {},
): Promise<InventoryDiagnosticsResponse> {
  const limit = Math.max(1, Math.min(Number(params.limit ?? 200), 500));
  const q = params.q?.trim() ?? "";
  const productId = params.productId?.trim() || null;
  const currentYear = new Date().getFullYear();
  const previousYear = currentYear - 1;

  const ctx = productId
    ? await loadInventoryContextForProduct(productId, undefined, 90)
    : await loadInventoryContext(undefined, 90);

  let products = productId
    ? ctx.products.filter((product) => product.id === productId)
    : ctx.products;

  if (q) products = products.filter((product) => productMatchesQuery(product, q));
  products = products.slice(0, limit);
  const productIds = products.map((product) => product.id);

  const [salesWindows, previousYearSales, syncStatuses] = await Promise.all([
    fetchSalesUnitsLastDays(productIds, [30, 60, 90], "ALL"),
    fetchPreviousYearMonthlySalesBatch(productIds, previousYear, null, null),
    fetchAmazonSyncJobStatuses(SYNC_JOB_KEYS),
  ]);

  const diagnostics: InventoryProductDiagnostics[] = products.map((product) => {
    const inventoryRows = ctx.inventoryRows.filter((row) => row.producto_id === product.id);
    const legacyFbaUnits = inventoryRows.reduce(
      (total, row) => total + Number(row.stock_fba ?? 0),
      0,
    );
    const legacyFbmUnits = inventoryRows.reduce(
      (total, row) => total + Number(row.stock_fbm ?? 0),
      0,
    );
    const legacyTotalUnits = legacyFbaUnits + legacyFbmUnits;
    const snapshot = ctx.fbaInventorySnapshotLatest.get(product.id) ?? null;
    const ledger = ctx.fbaLedgerLatest.get(product.id) ?? null;
    const inboundRows = ctx.inbound.get(product.id) ?? [];
    const amazonShipmentIds = Array.from(
      new Set(
        inboundRows
          .filter((row) => row.logisticsKind === "amazon_inbound" || row.amazonShipmentId)
          .map((row) => row.amazonShipmentId ?? row.seguimiento ?? "")
          .filter(Boolean),
      ),
    );
    const sales = salesWindows.get(product.id) ?? {};
    const sales30Units = Number(sales[30] ?? 0);
    const sales60Units = Number(sales[60] ?? 0);
    const sales90Units = Number(sales[90] ?? 0);
    const previousYearUnits = sum(previousYearSales.get(product.id) ?? []);
    const fbaSnapshotUnits = snapshot?.fulfillableQuantity ?? null;
    const fbaDifferenceUnits =
      fbaSnapshotUnits == null ? null : fbaSnapshotUnits - legacyFbaUnits;
    const fbaDifferenceSeverity = differenceSeverity({
      snapshotUnits: fbaSnapshotUnits,
      legacyUnits: legacyFbaUnits,
    });

    const missingData: string[] = [];
    const warnings: string[] = [];
    const recommendedActions: string[] = [];

    if (!snapshot) {
      missingData.push("Sin snapshot FBA operativo");
      if (legacyFbaUnits > 0) {
        warnings.push("Usando FBA Country / inventario_paises como fuente FBA auxiliar");
      }
      recommendedActions.push("Revisar sincronización de snapshot FBA SP-API");
    }
    if (sales90Units <= 0) {
      missingData.push("Sin ventas recientes");
      recommendedActions.push("Revisar importación de ventas reales FBA/FBM");
    }
    if (previousYearUnits <= 0) {
      missingData.push("Sin histórico año anterior");
      recommendedActions.push("Revisar histórico de ventas del año anterior");
    }
    if (!ledger) {
      missingData.push("Sin ledger FBA");
      recommendedActions.push("Revisar importación de ledger FBA");
    }
    if (legacyFbmUnits > 0) {
      warnings.push("FBM procede de inventario_paises legacy");
      recommendedActions.push("Diseñar snapshot FBM SP-API");
    }
    if (fbaDifferenceSeverity !== "ok") {
      warnings.push("Diferencia entre snapshot FBA SP-API y FBA legacy país");
      pushUnique(recommendedActions, "Usar snapshot FBA como input operativo y mantener país como auxiliar");
    }

    const hasSupplyConfig = ctx.stockSuggestions.has(product.id);

    return {
      productId: product.id,
      sku: product.sku,
      nombre: product.nombre ?? product.sku,
      hasFbaSnapshot: snapshot != null,
      fbaSnapshotUnits,
      fbaSnapshotAt: snapshot?.snapshotAt ?? null,
      fbaSnapshotSource: snapshot?.source ?? null,
      legacyFbaUnits,
      legacyFbmUnits,
      legacyTotalUnits,
      fbaDifferenceUnits,
      fbaDifferenceSeverity,
      sales30Units,
      sales60Units,
      sales90Units,
      hasRecentSales: sales90Units > 0,
      hasSalesPreviousYear: previousYearUnits > 0,
      previousYearUnits,
      hasLedger: ledger != null,
      ledgerUnits: ledger?.stockSellable ?? null,
      ledgerDate: ledger?.snapshotDate ?? null,
      hasInbound: inboundRows.length > 0,
      inboundUnits: inboundRows.reduce(
        (total, row) => total + Number(row.cantidadPendiente ?? 0),
        0,
      ),
      hasAmazonInbound: amazonShipmentIds.length > 0,
      amazonShipmentIds,
      hasBenchmark: ctx.benchmarkIds.has(product.id),
      hasSupplyConfig,
      missingData,
      warnings,
      recommendedActions: Array.from(new Set(recommendedActions)),
    };
  });

  const filtered = params.onlyMissing
    ? diagnostics.filter(
        (product) => product.missingData.length > 0 || product.warnings.length > 0,
      )
    : diagnostics;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    syncStatus: Object.fromEntries(
      SYNC_JOB_KEYS.map((key) => [key, syncStatuses.get(key) ?? null]),
    ),
    summary: {
      totalProducts: filtered.length,
      productsWithoutFbaSnapshot: filtered.filter((p) => !p.hasFbaSnapshot).length,
      productsWithoutRecentSales: filtered.filter((p) => !p.hasRecentSales).length,
      productsWithoutPreviousYearSales: filtered.filter((p) => !p.hasSalesPreviousYear).length,
      productsWithFbaDifference: filtered.filter((p) => p.fbaDifferenceSeverity !== "ok").length,
      productsWithInbound: filtered.filter((p) => p.hasInbound).length,
      productsWithAmazonInbound: filtered.filter((p) => p.hasAmazonInbound).length,
      productsUsingLegacyFbm: filtered.filter((p) => p.legacyFbmUnits > 0).length,
    },
    products: filtered,
  };
}
