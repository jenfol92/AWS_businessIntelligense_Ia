// modules/inventory/repositories/inventoryRepository.ts
//
// Acceso a Supabase para el módulo Inventario.
// NO calcula reglas de negocio complejas; solo lecturas y agregados básicos.

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { supabaseAdmin } from "@/server/supabase/adminClient";
import { salesChannelToMarketplaceCountry } from "@/modules/amazon-sp-api/marketplaceMapping";
import {
  filterRowsByCompetitorSelection,
  resolveSelectionFilterForProduct,
} from "@/modules/products/repositories/productCompetitorBenchmarkSelectionRepository";
import { fetchForecastInboundItems } from "@/modules/planner/repositories/forecastInboundRepository";
import { mapForecastInboundToInventoryRow } from "@/modules/planner/services/mapForecastInboundToInventoryRow";
import type {
  InventoryInboundRow,
  InventoryCountryPriceChannel,
  InventoryCountryPriceDistributionRow,
  InventoryLoteRow,
  InventoryRow,
  FbaInventoryCountryStockRow,
  ProductBaseRow,
  SalesAgg,
  SalesByProductCountry,
  MarketplaceSalesAgg,
  MarketplaceSalesByProductCountry,
} from "../types/inventory.types";
import type { AmazonSyncJobStatus } from "../services/resolveOperationalStock";
import {
  aggregateCanonicalSnapshotAcrossOperationalPools,
  type CanonicalInventorySnapshotReadRow,
} from "../services/canonicalInventorySnapshotAggregation";
import {
  buildInclusiveDateWindow,
  isDateInInclusiveWindow,
} from "../services/inclusiveDateWindow";

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function firstRelation<T>(rel: T | T[] | null | undefined): T | null {
  if (rel == null) return null;
  return Array.isArray(rel) ? (rel[0] ?? null) : rel;
}

function salesKey(productoId: string, pais: string): string {
  return `${productoId}::${pais}`;
}

function salesKeyGlobal(productoId: string): string {
  return `${productoId}::__ALL__`;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function normalizeShipCountry(raw: string | null | undefined): string {
  const value = String(raw ?? "").trim().toUpperCase();
  if (!value || value === "--") return "UNKNOWN";
  return value;
}


type AmazonSyncJobRow = {
  job_key: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_rows_upserted: number | null;
  next_run_hint: string | null;
};

function mapAmazonSyncJobRow(row: AmazonSyncJobRow): AmazonSyncJobStatus {
  return {
    jobKey: row.job_key,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastRowsUpserted: row.last_rows_upserted,
    nextRunHint: row.next_run_hint,
  };
}

const PRODUCT_BASE_SELECT =
  "id, sku, nombre, estado, proveedor_id, parent_id, stock_seguridad_minimo";

function dedupeProductsById(products: ProductBaseRow[]): ProductBaseRow[] {
  return Array.from(new Map(products.map((p) => [p.id, p])).values()).sort(
    (a, b) => a.sku.localeCompare(b.sku),
  );
}

/** Productos activos para el dashboard de inventario. */
export async function fetchActiveProducts(): Promise<ProductBaseRow[]> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("productos")
    .select(PRODUCT_BASE_SELECT)
    .eq("estado", "activo")
    .order("sku", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ProductBaseRow[];
}

/** Lista ligera de productos activos para seleccionar un detalle sin cargar dashboard. */
export async function fetchInventoryProductsLite(): Promise<ProductBaseRow[]> {
  return fetchActiveProducts();
}

export async function fetchAmazonSyncJobStatus(
  jobKey: string,
): Promise<AmazonSyncJobStatus | null> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("amazon_sync_jobs")
    .select(
      "job_key, last_run_at, last_success_at, last_status, last_error, last_rows_upserted, next_run_hint",
    )
    .eq("job_key", jobKey)
    .maybeSingle();

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[inventory] amazon_sync_jobs status unavailable", {
        jobKey,
        error,
      });
    }
    return null;
  }

  const row = data as AmazonSyncJobRow | null;
  if (!row) return null;

  return mapAmazonSyncJobRow(row);
}

export async function fetchAmazonSyncJobStatuses(
  jobKeys: string[],
): Promise<Map<string, AmazonSyncJobStatus>> {
  const result = new Map<string, AmazonSyncJobStatus>();
  const keys = Array.from(new Set(jobKeys.map((key) => key.trim()).filter(Boolean)));
  if (keys.length === 0) return result;

  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("amazon_sync_jobs")
    .select(
      "job_key, last_run_at, last_success_at, last_status, last_error, last_rows_upserted, next_run_hint",
    )
    .in("job_key", keys);

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[inventory] amazon_sync_jobs statuses unavailable", {
        jobKeys: keys,
        error,
      });
    }
    return result;
  }

  for (const row of (data ?? []) as AmazonSyncJobRow[]) {
    result.set(row.job_key, mapAmazonSyncJobRow(row));
  }

  return result;
}

/** Producto activo seleccionado y su familia minima para el detalle de inventario. */
export async function fetchInventoryProductScope(
  productId: string,
): Promise<ProductBaseRow[]> {
  const supabase = createSupabaseRouteClient();
  const { data: selected, error: selectedError } = await supabase
    .from("productos")
    .select(PRODUCT_BASE_SELECT)
    .eq("id", productId)
    .eq("estado", "activo")
    .maybeSingle();

  if (selectedError) throw new Error(selectedError.message);
  if (!selected) return [];

  const selectedProduct = selected as ProductBaseRow;
  const products: ProductBaseRow[] = [selectedProduct];

  if (selectedProduct.parent_id) {
    const [parentResult, siblingsResult] = await Promise.all([
      supabase
        .from("productos")
        .select(PRODUCT_BASE_SELECT)
        .eq("id", selectedProduct.parent_id)
        .eq("estado", "activo")
        .maybeSingle(),
      supabase
        .from("productos")
        .select(PRODUCT_BASE_SELECT)
        .eq("parent_id", selectedProduct.parent_id)
        .eq("estado", "activo")
        .order("sku", { ascending: true }),
    ]);

    if (parentResult.error) throw new Error(parentResult.error.message);
    if (siblingsResult.error) throw new Error(siblingsResult.error.message);

    if (parentResult.data) products.push(parentResult.data as ProductBaseRow);
    products.push(...((siblingsResult.data ?? []) as ProductBaseRow[]));
  } else {
    const { data: children, error: childrenError } = await supabase
      .from("productos")
      .select(PRODUCT_BASE_SELECT)
      .eq("parent_id", selectedProduct.id)
      .eq("estado", "activo")
      .order("sku", { ascending: true });

    if (childrenError) throw new Error(childrenError.message);
    products.push(...((children ?? []) as ProductBaseRow[]));
  }

  return dedupeProductsById(products);
}

/** Inventario por pais para un conjunto de productos. */
export async function fetchInventoryRows(
  productIds: string[],
): Promise<InventoryRow[]> {
  if (productIds.length === 0) return [];
  const supabase = createSupabaseRouteClient();
  const rows: InventoryRow[] = [];

  for (const chunk of chunkArray(productIds, 200)) {
    const { data, error } = await supabase
      .from("inventario_paises")
      .select("producto_id, pais, stock_fba, stock_fbm, stock_pais, updated_at")
      .in("producto_id", chunk);

    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as InventoryRow[]));
  }
  return rows;
}

type VentasRow = {
  producto_id: string;
  pais: string | null;
  unidades_vendidas: number | null;
  fecha: string;
  canal_venta: string | null;
};

/**
 * Ventas agregadas por producto/país (ventana reciente y 90 días) y totales por producto.
 * `canal`: ALL | FBA | FBM | AMAZON_FBA | AMAZON_FBM
 */
export async function fetchSalesAggregates(
  productIds: string[],
  canal: string = "ALL",
  windowDays: number = 30,
  periodRange?: { fromDate?: string | null; toDate?: string | null },
): Promise<{
  byProductCountry: SalesByProductCountry;
  byProductGlobal: Map<string, SalesAgg>;
}> {
  const byProductCountry: SalesByProductCountry = new Map();
  const byProductGlobal = new Map<string, SalesAgg>();

  if (productIds.length === 0) {
    return { byProductCountry, byProductGlobal };
  }

  const supabase = createSupabaseRouteClient();
  const safeWindow = Math.max(1, Math.min(windowDays, 365));
  const today = todayIsoDate();
  const periodTo = normalizeIsoDate(periodRange?.toDate) ?? today;
  const periodFrom =
    normalizeIsoDate(periodRange?.fromDate) ?? addDaysIso(periodTo, -(safeWindow - 1));
  const from90Str = buildInclusiveDateWindow(periodTo, 90).fromDate;
  const fromStr = periodFrom < from90Str ? periodFrom : from90Str;

  const canalNorm =
    canal === "FBA" || canal === "FBM"
      ? canal
      : canal === "AMAZON_FBA"
        ? "FBA"
        : canal === "AMAZON_FBM"
          ? "FBM"
          : null;

  for (const chunk of chunkArray(productIds, 120)) {
    let offset = 0;
    const pageSize = 1000;

    for (;;) {
      let q = supabase
        .from("ventas_diarias")
        .select("producto_id, pais, unidades_vendidas, fecha, canal_venta")
        .gte("fecha", fromStr)
        .lte("fecha", periodTo)
        .in("producto_id", chunk)
        .order("fecha", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (canalNorm) q = q.eq("canal_venta", canalNorm);

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as VentasRow[];
      for (const row of rows) {
        const pid = row.producto_id;
        if (!pid) continue;
        const units = Number(row.unidades_vendidas ?? 0);
        const pais = row.pais ?? "—";
        const ck = salesKey(pid, pais);
        const curCountry =
          byProductCountry.get(ck) ?? { unitsPeriod: 0, units30: 0, units90: 0 };
        if (row.fecha >= from90Str) curCountry.units90 += units;
        if (row.fecha >= periodFrom && row.fecha <= periodTo) {
          curCountry.unitsPeriod += units;
          curCountry.units30 += units;
        }
        byProductCountry.set(ck, curCountry);

        const gk = salesKeyGlobal(pid);
        const curGlobal =
          byProductGlobal.get(gk) ?? { unitsPeriod: 0, units30: 0, units90: 0 };
        if (row.fecha >= from90Str) curGlobal.units90 += units;
        if (row.fecha >= periodFrom && row.fecha <= periodTo) {
          curGlobal.unitsPeriod += units;
          curGlobal.units30 += units;
        }
        byProductGlobal.set(gk, curGlobal);
      }

      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }

  return { byProductCountry, byProductGlobal };
}

type RawFbaMarketplaceSalesRow = {
  producto_id: string | null;
  sale_date: string | null;
  quantity: number | null;
  amount: number | null;
  ship_to_country: string | null;
  raw: Record<string, unknown> | null;
};

function emptyMarketplaceSalesAgg(
  marketplaceCountry: string,
): MarketplaceSalesAgg {
  return {
    marketplaceCountry,
    salesChannels: [],
    units30: 0,
    units90: 0,
    amount30: 0,
    amount90: 0,
    deliveryBreakdown: [],
  };
}

function addMarketplaceDeliveryBreakdown(
  agg: MarketplaceSalesAgg,
  shipCountry: string,
  quantity: number,
  amount: number,
  in30d: boolean,
) {
  const current =
    agg.deliveryBreakdown.find((row) => row.shipCountry === shipCountry) ??
    ({
      shipCountry,
      units30: 0,
      units90: 0,
      amount30: 0,
      amount90: 0,
    } satisfies MarketplaceSalesAgg["deliveryBreakdown"][number]);

  current.units90 += quantity;
  current.amount90 += amount;
  if (in30d) {
    current.units30 += quantity;
    current.amount30 += amount;
  }

  if (!agg.deliveryBreakdown.some((row) => row.shipCountry === shipCountry)) {
    agg.deliveryBreakdown.push(current);
  }
}

/**
 * Ventas FBA agrupadas por marketplace de venta (raw sales-channel).
 * No usa marketplace_id porque puede venir contaminado en históricos.
 */
export async function fetchMarketplaceSalesAggregates(
  productIds: string[],
  windows: {
    window30Days?: number;
    window90Days?: number;
    periodRange?: { fromDate?: string | null; toDate?: string | null };
  } = {},
): Promise<{
  byProductMarketplace: MarketplaceSalesByProductCountry;
}> {
  const byProductMarketplace: MarketplaceSalesByProductCountry = new Map();
  if (productIds.length === 0) return { byProductMarketplace };

  const supabase = supabaseAdmin;
  const safe30 = Math.max(1, Math.min(windows.window30Days ?? 30, 365));
  const safe90 = Math.max(safe30, Math.min(windows.window90Days ?? 90, 365));
  const toDate = normalizeIsoDate(windows.periodRange?.toDate) ?? todayIsoDate();
  const from30Str =
    normalizeIsoDate(windows.periodRange?.fromDate) ??
    buildInclusiveDateWindow(toDate, safe30).fromDate;
  const from90Str = buildInclusiveDateWindow(toDate, safe90).fromDate;
  const queryFrom = from30Str < from90Str ? from30Str : from90Str;
  const window30 = { fromDate: from30Str, toDate };
  const window90 = { fromDate: from90Str, toDate };

  for (const chunk of chunkArray(productIds, 120)) {
    let offset = 0;
    const pageSize = 1000;

    for (;;) {
      const { data, error } = await supabase
        .from("amazon_fba_sales_daily_raw")
        .select("producto_id, sale_date, quantity, amount, ship_to_country, raw")
        .gte("sale_date", queryFrom)
        .lte("sale_date", toDate)
        .in("producto_id", chunk)
        .order("sale_date", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as RawFbaMarketplaceSalesRow[];
      for (const row of rows) {
        const productId = row.producto_id;
        if (!productId || !row.sale_date) continue;

        const raw = row.raw ?? {};
        const reportType = String(raw.report_type ?? "");
        if (reportType !== "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL") {
          continue;
        }

        const salesChannel = String(raw["sales-channel"] ?? "").trim();
        const marketplaceCountry =
          salesChannelToMarketplaceCountry(salesChannel);
        if (!marketplaceCountry) continue;

        const quantity = Number(row.quantity ?? 0);
        if (!Number.isFinite(quantity) || quantity === 0) continue;
        const amount = Number(row.amount ?? 0);
        const safeAmount = Number.isFinite(amount) ? amount : 0;
        const key = salesKey(productId, marketplaceCountry);
        const agg =
          byProductMarketplace.get(key) ??
          emptyMarketplaceSalesAgg(marketplaceCountry);
        const in30d = isDateInInclusiveWindow(row.sale_date, window30);
        const in90d = isDateInInclusiveWindow(row.sale_date, window90);

        if (!in30d && !in90d) continue;

        if (in90d) {
          agg.units90 += quantity;
          agg.amount90 += safeAmount;
        }
        if (in30d) {
          agg.units30 += quantity;
          agg.amount30 += safeAmount;
        }
        if (salesChannel && !agg.salesChannels.includes(salesChannel)) {
          agg.salesChannels.push(salesChannel);
          agg.salesChannels.sort((a, b) => a.localeCompare(b));
        }

        if (in90d) {
          addMarketplaceDeliveryBreakdown(
            agg,
            normalizeShipCountry(row.ship_to_country),
            quantity,
            safeAmount,
            in30d,
          );
        }
        byProductMarketplace.set(key, agg);
      }

      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }

  for (const agg of Array.from(byProductMarketplace.values())) {
    agg.deliveryBreakdown.sort((a, b) => {
      if (b.units30 !== a.units30) return b.units30 - a.units30;
      if (b.units90 !== a.units90) return b.units90 - a.units90;
      return a.shipCountry.localeCompare(b.shipCountry);
    });
  }

  return { byProductMarketplace };
}

export async function fetchSalesUnitsLastDays(
  productIds: string[],
  days: number[],
  canal: string = "ALL",
): Promise<Map<string, Record<number, number>>> {
  const result = new Map<string, Record<number, number>>();
  const safeDays = Array.from(new Set(days.filter((day) => day > 0))).sort(
    (a, b) => a - b,
  );
  if (productIds.length === 0 || safeDays.length === 0) return result;

  for (const productId of productIds) {
    result.set(productId, Object.fromEntries(safeDays.map((day) => [day, 0])));
  }

  const maxDays = Math.max(...safeDays);
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - maxDays);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const cutoffs = new Map<number, string>();
  for (const day of safeDays) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - day);
    cutoffs.set(day, cutoff.toISOString().slice(0, 10));
  }

  const canalNorm =
    canal === "FBA" || canal === "FBM"
      ? canal
      : canal === "AMAZON_FBA"
        ? "FBA"
        : canal === "AMAZON_FBM"
          ? "FBM"
          : null;

  const supabase = createSupabaseRouteClient();
  for (const chunk of chunkArray(productIds, 120)) {
    let offset = 0;
    const pageSize = 1000;

    for (;;) {
      let q = supabase
        .from("ventas_diarias")
        .select("producto_id, unidades_vendidas, fecha, canal_venta")
        .gte("fecha", fromStr)
        .in("producto_id", chunk)
        .order("fecha", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (canalNorm) q = q.eq("canal_venta", canalNorm);

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as VentasRow[];
      for (const row of rows) {
        const productId = row.producto_id;
        if (!productId) continue;
        const units = Number(row.unidades_vendidas ?? 0);
        const current = result.get(productId) ?? {};
        for (const day of safeDays) {
          const cutoff = cutoffs.get(day)!;
          if (row.fecha >= cutoff) {
            current[day] = Number(current[day] ?? 0) + units;
          }
        }
        result.set(productId, current);
      }

      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }

  return result;
}

export async function fetchProductDetailsMap(productIds: string[]) {
  const map = new Map<
    string,
    { categoria: string | null; imagen_url: string | null }
  >();
  if (productIds.length === 0) return map;

  const supabase = createSupabaseRouteClient();
  for (const chunk of chunkArray(productIds, 200)) {
    const { data, error } = await supabase
      .from("producto_detalle")
      .select("producto_id, categoria, imagen_url")
      .in("producto_id", chunk);

    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      map.set(String(r.producto_id), {
        categoria: r.categoria != null ? String(r.categoria) : null,
        imagen_url: r.imagen_url != null ? String(r.imagen_url) : null,
      });
    }
  }
  return map;
}

export async function fetchSuppliersMap(supplierIds: string[]) {
  const map = new Map<string, { nombre: string | null }>();
  const unique = Array.from(new Set(supplierIds.filter(Boolean)));
  if (unique.length === 0) return map;

  const supabase = createSupabaseRouteClient();
  for (const chunk of chunkArray(unique, 200)) {
    const { data, error } = await supabase
      .from("proveedores")
      .select("id, nombre")
      .in("id", chunk);

    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const r = row as { id: string; nombre: string | null };
      map.set(r.id, { nombre: r.nombre });
    }
  }
  return map;
}

export async function fetchStockSuggestionsMap(productIds: string[]) {
  const map = new Map<
    string,
    {
      dias_cobertura: number | null;
      unidades_a_pedir: number;
      riesgo: string | null;
      lead_time_days: number | null;
      stock_actual: number;
      stock_fba: number;
      stock_fbm: number;
    }
  >();
  if (productIds.length === 0) return map;

  const supabase = createSupabaseRouteClient();
  for (const chunk of chunkArray(productIds, 200)) {
    const { data, error } = await supabase
      .from("v_stock_seguridad_sugerido")
      .select(
        "producto_id, dias_cobertura, unidades_a_pedir, riesgo, lead_time_days, stock_actual, stock_fba, stock_fbm",
      )
      .in("producto_id", chunk);

    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      map.set(String(r.producto_id), {
        dias_cobertura:
          r.dias_cobertura != null ? Number(r.dias_cobertura) : null,
        unidades_a_pedir: Number(r.unidades_a_pedir ?? 0),
        riesgo: r.riesgo != null ? String(r.riesgo) : null,
        lead_time_days:
          r.lead_time_days != null ? Number(r.lead_time_days) : null,
        stock_actual: Number(r.stock_actual ?? 0),
        stock_fba: Number(r.stock_fba ?? 0),
        stock_fbm: Number(r.stock_fbm ?? 0),
      });
    }
  }
  return map;
}

/** Productos con benchmark de competidor disponible. */
export async function fetchBenchmarkFlags(
  products: ProductBaseRow[],
): Promise<Set<string>> {
  const withBenchmark = new Set<string>();
  const productIds = products.map((p) => p.id);
  const skuToId = new Map(products.map((p) => [p.sku, p.id]));

  if (productIds.length === 0) return withBenchmark;

  const supabase = createSupabaseRouteClient();

  for (const chunk of chunkArray(productIds, 150)) {
    const { data } = await supabase
      .from("competitor_benchmark_snapshots")
      .select("producto_id, estimated_monthly_units")
      .in("producto_id", chunk)
      .gt("estimated_monthly_units", 0);

    for (const row of data ?? []) {
      const r = row as { producto_id: string | null };
      if (r.producto_id) withBenchmark.add(r.producto_id);
    }
  }

  const skus = products.map((p) => p.sku).filter(Boolean);
  for (const chunk of chunkArray(skus, 150)) {
    const { data } = await supabase
      .from("competitor_benchmark_snapshots")
      .select("candidate_sku, estimated_monthly_units")
      .in("candidate_sku", chunk)
      .gt("estimated_monthly_units", 0);

    for (const row of data ?? []) {
      const r = row as { candidate_sku: string | null };
      if (r.candidate_sku) {
        const pid = skuToId.get(r.candidate_sku);
        if (pid) withBenchmark.add(pid);
      }
    }
  }

  return withBenchmark;
}

/** Inbound pendiente por producto vía v_forecast_inbound_items (contenedor → orden → item). */
export async function fetchInboundByProductIds(
  productIds: string[],
): Promise<Map<string, InventoryInboundRow[]>> {
  const result = new Map<string, InventoryInboundRow[]>();
  if (productIds.length === 0) return result;

  const items = await fetchForecastInboundItems({ productoIds: productIds });
  const supabase = createSupabaseRouteClient();

  for (const item of items) {
    const row = mapForecastInboundToInventoryRow(item);
    const list = result.get(item.producto_id) ?? [];
    list.push(row);
    result.set(item.producto_id, list);
  }

  const allRows = Array.from(result.values()).flat();
  const orderIds = Array.from(new Set(allRows.map((row) => row.ordenId).filter(Boolean)));

  if (orderIds.length > 0) {
    const { data: orders, error: ordersError } = await supabase
      .from("ordenes_compra")
      .select("id, numero_pedido_agente")
      .in("id", orderIds);

    if (!ordersError) {
      const orderAgent = new Map<string, string | null>();
      for (const order of orders ?? []) {
        const row = order as { id: string; numero_pedido_agente: string | null };
        orderAgent.set(row.id, row.numero_pedido_agente);
      }
      for (const row of allRows) {
        row.numeroPedidoAgente = orderAgent.get(row.ordenId) ?? row.numeroPedidoAgente;
      }
    } else if (process.env.NODE_ENV === "development") {
      console.error("[inventory] fetch numero_pedido_agente failed", {
        orderIdsCount: orderIds.length,
        error: ordersError,
      });
    }

    const { data: assignments, error: assignmentsError } = await supabase
      .from("orden_logistics_assignments")
      .select(
        `orden_id, assignment_type, shipment_id, contenedor_id,
         amazon_inbound_shipments(
           shipment_id, shipment_name, estado_amazon, destination_center
         )`,
      )
      .in("orden_id", orderIds);

    if (!assignmentsError) {
      const assignmentByOrder = new Map<string, Record<string, unknown>>();
      for (const assignment of assignments ?? []) {
        const row = assignment as Record<string, unknown>;
        const orderId = String(row.orden_id ?? "");
        if (orderId && !assignmentByOrder.has(orderId)) assignmentByOrder.set(orderId, row);
      }

      for (const row of allRows) {
        const assignment = assignmentByOrder.get(row.ordenId);
        const assignmentType = assignment ? String(assignment.assignment_type ?? "") : "";
        if (assignmentType === "amazon_inbound") {
          const shipment = firstRelation(
            assignment?.amazon_inbound_shipments as
              | {
                  shipment_id: string | null;
                  shipment_name: string | null;
                  estado_amazon: string | null;
                  destination_center: string | null;
                }
              | Array<{
                  shipment_id: string | null;
                  shipment_name: string | null;
                  estado_amazon: string | null;
                  destination_center: string | null;
                }>
              | null
              | undefined,
          );
          const shipmentId = String(assignment?.shipment_id ?? shipment?.shipment_id ?? "").trim();
          row.logisticsKind = "amazon_inbound";
          row.amazonShipmentId = shipmentId || null;
          row.amazonShipmentName = shipment?.shipment_name ?? null;
          row.amazonStatus = shipment?.estado_amazon ?? null;
          row.amazonDestinationCenter = shipment?.destination_center ?? null;
          row.seguimiento = shipmentId || "Sin seguimiento";
        } else if (row.contenedorId) {
          row.logisticsKind = "contenedor_propio";
          row.seguimiento = row.contenedorIdentificador ?? row.contenedorId;
        } else {
          row.logisticsKind = "none";
          row.seguimiento = null;
        }
      }
    } else if (process.env.NODE_ENV === "development") {
      console.error("[inventory] fetch logistics assignments failed", {
        orderIdsCount: orderIds.length,
        error: assignmentsError,
      });
    }
  }

  for (const [productId, rows] of Array.from(result.entries())) {
    rows.sort((a, b) => {
      const etaA = a.eta ?? "9999-12-31";
      const etaB = b.eta ?? "9999-12-31";
      if (etaA !== etaB) return etaA.localeCompare(etaB);
      return (a.numeroOrden ?? "").localeCompare(b.numeroOrden ?? "");
    });
    result.set(productId, rows);
  }

  return result;
}

/** Lotes desde producto_costos + cantidades en orden_items (no inventario_paises). */
export async function fetchLotesForProduct(
  productoId: string,
  paisFilter?: string,
): Promise<InventoryLoteRow[]> {
  const supabase = createSupabaseRouteClient();

  let costQuery = supabase
    .from("producto_costos")
    .select(
      `id, fecha, lote_producto, contenedor_id, costo_unitario_total_eur, pais_destino,
       contenedores:contenedor_id(identificador_embarque)`,
    )
    .eq("producto_id", productoId)
    .not("lote_producto", "is", null)
    .order("fecha", { ascending: false })
    .limit(50);

  if (paisFilter && paisFilter.trim() !== "") {
    costQuery = costQuery.eq("pais_destino", paisFilter.trim());
  }

  const { data: costosRaw, error: costosErr } = await costQuery;
  if (costosErr) throw new Error(costosErr.message);

  const lotes: InventoryLoteRow[] = [];

  for (const pc of costosRaw ?? []) {
    const row = pc as Record<string, unknown>;
    const lote = row.lote_producto != null ? String(row.lote_producto) : "";
    if (!lote) continue;

    let cantidad = 0;
    const contenedorId = row.contenedor_id as string | null;

    if (contenedorId) {
      const { data: linkOrdenes } = await supabase
        .from("contenedor_ordenes")
        .select("orden_id")
        .eq("contenedor_id", contenedorId);

      const ordenIds = (linkOrdenes ?? []).map(
        (l: { orden_id: string }) => l.orden_id,
      );

      if (ordenIds.length > 0) {
        const { data: its } = await supabase
          .from("orden_items")
          .select("cantidad")
          .in("orden_id", ordenIds)
          .eq("producto_id", productoId)
          .eq("lote_producto", lote);

        cantidad = (its ?? []).reduce(
          (s: number, it: { cantidad: number | null }) =>
            s + Number(it.cantidad ?? 0),
          0,
        );
      }
    }

    const contInfo = firstRelation(
      row.contenedores as
        | { identificador_embarque: string | null }
        | { identificador_embarque: string | null }[]
        | null,
    );

    const costoUnitario =
      row.costo_unitario_total_eur != null
        ? Number(row.costo_unitario_total_eur)
        : null;

    lotes.push({
      lote,
      unidades: cantidad,
      costoUnitario,
      costoTotal:
        costoUnitario != null && cantidad > 0
          ? costoUnitario * cantidad
          : null,
      fecha: row.fecha != null ? String(row.fecha) : null,
      contenedorIdentificador: contInfo?.identificador_embarque ?? null,
      paisDestino:
        row.pais_destino != null ? String(row.pais_destino) : null,
    });
  }

  return lotes;
}

export async function fetchCosteMedioResumen(productoId: string) {
  const supabase = createSupabaseRouteClient();
  const { data } = await supabase
    .from("v_producto_coste_medio")
    .select("*")
    .eq("producto_id", productoId)
    .maybeSingle();

  return data;
}

type VentasMonthlyRow = {
  fecha: string;
  unidades_vendidas: number | null;
  pais: string | null;
  canal_venta: string | null;
};

function emptyMonthlyArray(): number[] {
  return Array.from({ length: 12 }, () => 0);
}

function monthIndexFromIso(iso: string): number {
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12 ? m - 1 : 0;
}

/**
 * Ventas mensuales del año natural anterior (índice 0 = enero).
 * Filtra por producto, países opcionales y canal_venta opcional.
 */
export async function fetchPreviousYearMonthlySales(
  productoId: string,
  previousYear: number,
  countries: string[] | null,
  ventasCanal: string | null,
): Promise<number[]> {
  const monthly = emptyMonthlyArray();
  const supabase = createSupabaseRouteClient();
  const fromStr = `${previousYear}-01-01`;
  const toStr = `${previousYear}-12-31`;

  let offset = 0;
  const pageSize = 1000;

  for (;;) {
    let q = supabase
      .from("ventas_diarias")
      .select("fecha, unidades_vendidas, pais, canal_venta")
      .eq("producto_id", productoId)
      .gte("fecha", fromStr)
      .lte("fecha", toStr)
      .order("fecha", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (countries && countries.length === 1) {
      q = q.eq("pais", countries[0]!);
    } else if (countries && countries.length > 1) {
      q = q.in("pais", countries);
    }
    if (ventasCanal) q = q.eq("canal_venta", ventasCanal);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as VentasMonthlyRow[];
    for (const row of rows) {
      const units = Number(row.unidades_vendidas ?? 0);
      monthly[monthIndexFromIso(row.fecha)] += units;
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return monthly;
}

/** Ventas mensuales año anterior para varios productos (misma agregación). */
export async function fetchPreviousYearMonthlySalesBatch(
  productIds: string[],
  previousYear: number,
  countries: string[] | null,
  ventasCanal: string | null,
): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  for (const id of productIds) {
    result.set(id, emptyMonthlyArray());
  }
  if (productIds.length === 0) return result;

  const supabase = createSupabaseRouteClient();
  const fromStr = `${previousYear}-01-01`;
  const toStr = `${previousYear}-12-31`;

  for (const chunk of chunkArray(productIds, 80)) {
    let offset = 0;
    const pageSize = 1000;

    for (;;) {
      let q = supabase
        .from("ventas_diarias")
        .select("producto_id, fecha, unidades_vendidas, pais, canal_venta")
        .gte("fecha", fromStr)
        .lte("fecha", toStr)
        .in("producto_id", chunk)
        .order("fecha", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (countries && countries.length === 1) {
        q = q.eq("pais", countries[0]!);
      } else if (countries && countries.length > 1) {
        q = q.in("pais", countries);
      }
      if (ventasCanal) q = q.eq("canal_venta", ventasCanal);

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const rows = (data ?? []) as (VentasMonthlyRow & { producto_id: string })[];
      for (const row of rows) {
        const pid = row.producto_id;
        if (!pid) continue;
        const monthly = result.get(pid) ?? emptyMonthlyArray();
        monthly[monthIndexFromIso(row.fecha)] += Number(row.unidades_vendidas ?? 0);
        result.set(pid, monthly);
      }

      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }

  return result;
}

type BenchmarkSnapshotRow = {
  producto_id: string | null;
  candidate_sku: string | null;
  marketplace_country: string | null;
  competitor_asin: string | null;
  estimated_monthly_units: number | null;
};

const BENCHMARK_SNAPSHOT_SELECT =
  "producto_id, candidate_sku, marketplace_country, competitor_asin, estimated_monthly_units";

/** Snapshots de benchmark para un producto, opcionalmente filtrados por marketplace_country. */
export async function fetchBenchmarkSnapshotsForProduct(
  productoId: string,
  sku: string,
  marketplaceCountry: string | null,
): Promise<{
  rows: BenchmarkSnapshotRow[];
  hasCountrySpecific: boolean;
  hasAny: boolean;
}> {
  const supabase = createSupabaseRouteClient();
  const selectionFilter = await resolveSelectionFilterForProduct(
    productoId,
    marketplaceCountry,
  );
  const rows: BenchmarkSnapshotRow[] = [];

  let qById = supabase
    .from("competitor_benchmark_snapshots")
    .select(BENCHMARK_SNAPSHOT_SELECT)
    .eq("producto_id", productoId)
    .gt("estimated_monthly_units", 0);

  if (marketplaceCountry) {
    qById = qById.eq("marketplace_country", marketplaceCountry);
  }

  const { data: byId, error: errId } = await qById;
  if (errId) throw new Error(errId.message);
  rows.push(...((byId ?? []) as BenchmarkSnapshotRow[]));

  if (sku) {
    let qBySku = supabase
      .from("competitor_benchmark_snapshots")
      .select(BENCHMARK_SNAPSHOT_SELECT)
      .eq("candidate_sku", sku)
      .gt("estimated_monthly_units", 0);

    if (marketplaceCountry) {
      qBySku = qBySku.eq("marketplace_country", marketplaceCountry);
    }

    const { data: bySku, error: errSku } = await qBySku;
    if (errSku) throw new Error(errSku.message);
    rows.push(...((bySku ?? []) as BenchmarkSnapshotRow[]));
  }

  const dedup = new Map<string, BenchmarkSnapshotRow>();
  for (const row of rows) {
    const key = `${row.producto_id ?? ""}::${row.candidate_sku ?? ""}::${row.marketplace_country ?? ""}::${row.competitor_asin ?? ""}`;
    dedup.set(key, row);
  }
  let unique = Array.from(dedup.values());

  unique = filterRowsByCompetitorSelection(
    unique,
    (row) => row.competitor_asin,
    selectionFilter,
  );

  let hasCountrySpecific = false;
  if (marketplaceCountry) {
    hasCountrySpecific = unique.some(
      (r) => r.marketplace_country === marketplaceCountry,
    );
  }

  return {
    rows: unique,
    hasCountrySpecific,
    hasAny: unique.length > 0,
  };
}

type FbaStockDailyRow = {
  snapshot_date: string;
  stock_sellable: number | null;
};

/**
 * Stock FBA sellable agregado por día (suma SKUs) para un producto y año natural.
 * Fuente: v_product_fba_stock_daily.
 */
export async function fetchProductFbaStockDailyByYear(
  productoId: string,
  year: number,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const supabase = createSupabaseRouteClient();
  const fromStr = `${year}-01-01`;
  const toStr = `${year}-12-31`;

  let offset = 0;
  const pageSize = 1000;

  for (;;) {
    const { data, error } = await supabase
      .from("v_product_fba_stock_daily")
      .select("snapshot_date, stock_sellable")
      .eq("producto_id", productoId)
      .gte("snapshot_date", fromStr)
      .lte("snapshot_date", toStr)
      .order("snapshot_date", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as FbaStockDailyRow[];
    for (const row of rows) {
      const date = row.snapshot_date.slice(0, 10);
      const sellable = Number(row.stock_sellable ?? 0);
      result.set(date, (result.get(date) ?? 0) + sellable);
    }

    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  return result;
}

type LatestFbaLedgerStockRpcRow = {
  producto_id: string;
  snapshot_date: string;
  stock_sellable: number | null;
  stock_total: number | null;
};

type RawPriceRow = {
  unitPrice: number;
  units: number;
  grossAmount: number;
  lastSaleDate: string | null;
  source: string;
  country?: string;
};

function normalizePriceChannelScope(channelScope: string | null | undefined): InventoryCountryPriceChannel {
  const raw = String(channelScope ?? "ALL").trim().toUpperCase();
  if (raw === "FBA" || raw === "AMAZON_FBA") return "FBA";
  if (raw === "FBM" || raw === "AMAZON_FBM") return "FBM";
  return "ALL";
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function addPriceRowsToDistribution(
  grouped: Map<string, InventoryCountryPriceDistributionRow>,
  rows: RawPriceRow[],
) {
  for (const row of rows) {
    if (!Number.isFinite(row.unitPrice) || row.unitPrice <= 0) continue;
    if (!Number.isFinite(row.units) || row.units === 0) continue;
    const unitPrice = roundMoney(row.unitPrice);
    const key = unitPrice.toFixed(2);
    const current =
      grouped.get(key) ??
      ({
        unitPrice,
        units: 0,
        grossAmount: 0,
        lastSaleDate: null,
        source: row.source,
      } satisfies InventoryCountryPriceDistributionRow);
    current.units += row.units;
    current.grossAmount += row.grossAmount;
    if (!current.lastSaleDate || (row.lastSaleDate && row.lastSaleDate > current.lastSaleDate)) {
      current.lastSaleDate = row.lastSaleDate;
    }
    grouped.set(key, current);
  }
}

function sortPriceDistribution(
  rows: InventoryCountryPriceDistributionRow[],
): InventoryCountryPriceDistributionRow[] {
  const totalUnits = rows.reduce((sum, row) => sum + row.units, 0);
  return rows
    .map((row) => ({
      ...row,
      grossAmount: roundMoney(row.grossAmount),
      percentageUnits: totalUnits > 0 ? roundMoney((row.units / totalUnits) * 100) : 0,
    }))
    .sort((a, b) => {
      if (b.units !== a.units) return b.units - a.units;
      const dateCmp = String(b.lastSaleDate ?? "").localeCompare(String(a.lastSaleDate ?? ""));
      if (dateCmp !== 0) return dateCmp;
      return b.unitPrice - a.unitPrice;
    });
}

async function fetchFbaPriceDistributionRows(params: {
  productId: string;
  country: string;
  fromDate: string;
  toDate?: string | null;
}): Promise<RawPriceRow[]> {
  const supabase = supabaseAdmin;
  const rows: RawPriceRow[] = [];
  let offset = 0;
  const pageSize = 1000;
  if (!params.productId) return rows;

  for (;;) {
    const { data, error } = await supabase
      .from("amazon_fba_sales_daily_raw")
      .select("sale_date, quantity, amount, raw")
      .eq("producto_id", params.productId)
      .gte("sale_date", params.fromDate)
      .lte("sale_date", normalizeIsoDate(params.toDate) ?? todayIsoDate())
      .not("amount", "is", null)
      .neq("quantity", 0)
      .order("sale_date", { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[inventory-price-distribution] FBA raw query error", {
          productId: params.productId,
          country: params.country,
          fromDate: params.fromDate,
          error,
        });
      }
      throw new Error(error.message);
    }

    if (process.env.NODE_ENV === "development") {
      console.log("[inventory-price-distribution] FBA raw page", {
        productId: params.productId,
        country: params.country,
        fromDate: params.fromDate,
        offset,
        rowsRecovered: data?.length ?? 0,
        emptyWithoutError: (data?.length ?? 0) === 0,
      });
    }

    for (const row of data ?? []) {
      const raw = (row as { raw?: unknown }).raw;
      const reportType =
        raw && typeof raw === "object"
          ? String((raw as Record<string, unknown>).report_type ?? "")
          : "";
      if (reportType !== "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL") {
        continue;
      }

      const salesChannel =
        raw && typeof raw === "object"
          ? String((raw as Record<string, unknown>)["sales-channel"] ?? "").trim()
          : "";
      const marketplaceCountry = salesChannelToMarketplaceCountry(salesChannel);
      if (marketplaceCountry !== params.country) continue;

      const quantity = Number((row as { quantity?: unknown }).quantity ?? 0);
      const amount = Number((row as { amount?: unknown }).amount ?? 0);
      if (!Number.isFinite(quantity) || quantity === 0) continue;
      if (!Number.isFinite(amount) || amount <= 0) continue;

      rows.push({
        unitPrice: amount / quantity,
        units: quantity,
        grossAmount: amount,
        lastSaleDate: String((row as { sale_date?: unknown }).sale_date ?? "").slice(0, 10),
        source: "spapi_fba_customer_shipment_sales",
        country: marketplaceCountry,
      });
    }

    if ((data ?? []).length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

export async function fetchCountryPriceDistribution(params: {
  productId: string;
  country: string;
  channelScope?: string | null;
  windowDays?: 30 | 90;
  fromDate?: string | null;
  toDate?: string | null;
  limit?: number;
}): Promise<InventoryCountryPriceDistributionRow[]> {
  const safeWindow = params.windowDays === 90 ? 90 : 30;
  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  const toStr = normalizeIsoDate(params.toDate) ?? todayIsoDate();
  const fromStr = normalizeIsoDate(params.fromDate) ?? addDaysIso(toStr, -(safeWindow - 1));
  const channel = normalizePriceChannelScope(params.channelScope);
  const grouped = new Map<string, InventoryCountryPriceDistributionRow>();

  if (process.env.NODE_ENV === "development") {
    console.log("[inventory-price-distribution] request", {
      productId: params.productId,
      country: params.country,
      channelScope: params.channelScope ?? "ALL",
      channel,
      windowDays: safeWindow,
      fromDate: fromStr,
    });
  }

  if (channel === "ALL" || channel === "FBA") {
    addPriceRowsToDistribution(
      grouped,
      await fetchFbaPriceDistributionRows({
        productId: params.productId,
        country: params.country,
        fromDate: fromStr,
        toDate: toStr,
      }),
    );
  }

  const sorted = sortPriceDistribution(Array.from(grouped.values())).slice(0, limit);
  if (process.env.NODE_ENV === "development") {
    console.log("[inventory-price-distribution] result", {
      productId: params.productId,
      country: params.country,
      channel,
      windowDays: safeWindow,
      rows: sorted.length,
      emptyWithoutError: sorted.length === 0,
    });
  }
  return sorted;
}

export async function fetchTopPriceByProductCountry(params: {
  productId: string;
  countries: string[];
  channelScope?: string | null;
  fromDate: string;
  toDate: string;
}): Promise<Map<string, InventoryCountryPriceDistributionRow>> {
  const result = new Map<string, InventoryCountryPriceDistributionRow>();
  const countries = Array.from(
    new Set(params.countries.map((country) => country.trim().toUpperCase()).filter(Boolean)),
  );
  if (!params.productId || countries.length === 0) return result;

  const channel = normalizePriceChannelScope(params.channelScope);
  const groupedByCountry = new Map<
    string,
    Map<string, InventoryCountryPriceDistributionRow>
  >();

  function addRows(rows: RawPriceRow[]) {
    for (const row of rows) {
      const country = row.country?.trim().toUpperCase();
      if (!country || !countries.includes(country)) continue;
      const grouped =
        groupedByCountry.get(country) ??
        new Map<string, InventoryCountryPriceDistributionRow>();
      addPriceRowsToDistribution(grouped, [row]);
      groupedByCountry.set(country, grouped);
    }
  }

  if (channel === "ALL" || channel === "FBA") {
    const supabase = supabaseAdmin;
    let offset = 0;
    const pageSize = 1000;

    for (;;) {
      const { data, error } = await supabase
        .from("amazon_fba_sales_daily_raw")
        .select("sale_date, quantity, amount, raw")
        .eq("producto_id", params.productId)
        .gte("sale_date", params.fromDate)
        .lte("sale_date", params.toDate)
        .not("amount", "is", null)
        .neq("quantity", 0)
        .order("sale_date", { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error) throw new Error(error.message);

      addRows(
        (data ?? []).flatMap((row) => {
          const raw = (row as { raw?: unknown }).raw;
          const record =
            raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
          if (
            String(record.report_type ?? "") !==
            "GET_AMAZON_FULFILLED_SHIPMENTS_DATA_GENERAL"
          ) {
            return [];
          }

          const country = salesChannelToMarketplaceCountry(
            String(record["sales-channel"] ?? "").trim(),
          );
          const quantity = Number((row as { quantity?: unknown }).quantity ?? 0);
          const amount = Number((row as { amount?: unknown }).amount ?? 0);
          if (!country || !Number.isFinite(quantity) || quantity === 0) return [];
          if (!Number.isFinite(amount) || amount <= 0) return [];

          return [
            {
              unitPrice: amount / quantity,
              units: quantity,
              grossAmount: amount,
              lastSaleDate: String((row as { sale_date?: unknown }).sale_date ?? "").slice(0, 10),
              source: "spapi_fba_customer_shipment_sales",
              country,
            } satisfies RawPriceRow,
          ];
        }),
      );

      if ((data ?? []).length < pageSize) break;
      offset += pageSize;
    }
  }

  for (const [country, grouped] of Array.from(groupedByCountry.entries())) {
    const top = sortPriceDistribution(Array.from(grouped.values()))[0];
    if (top) result.set(country, top);
  }

  return result;
}

/**
 * Último snapshot FBA ledger por producto (suma SKUs del día más reciente).
 * Fuente: v_product_fba_stock_daily.
 */
export async function fetchLatestFbaLedgerStockByProductIds(
  productIds: string[],
): Promise<Map<string, import("../services/resolveOperationalStock").LatestFbaLedgerStock>> {
  const result = new Map<
    string,
    import("../services/resolveOperationalStock").LatestFbaLedgerStock
  >();
  if (productIds.length === 0) return result;

  const supabase = createSupabaseRouteClient();

  for (const chunk of chunkArray(productIds, 100)) {
    const { data, error } = await supabase.rpc(
      "get_latest_fba_ledger_stock_by_products",
      { product_ids: chunk },
    );

    if (error) {
      console.error(
        "[inventory-detail timing] fetchLatestFbaLedgerStockByProductIds failed",
        error,
        "No se pudo obtener latest FBA ledger stock. Revisa que la migración get_latest_fba_ledger_stock_by_products esté aplicada.",
      );
      return new Map();
    }

    const rows = (data ?? []) as LatestFbaLedgerStockRpcRow[];
    for (const row of rows) {
      if (!row.producto_id || !row.snapshot_date) continue;
      result.set(String(row.producto_id), {
        snapshotDate: row.snapshot_date.slice(0, 10),
        stockSellable: Number(row.stock_sellable ?? 0),
        stockTotal: Number(row.stock_total ?? 0),
      });
    }
  }

  return result;
}

type LatestFbaInventoryByCountryViewRow = {
  producto_id: string | null;
  pais: string | null;
  snapshot_date: string | null;
  last_imported_at: string | null;
  stock_fba_sellable: number | null;
  stock_fba_unsellable: number | null;
  stock_fba_physical_total: number | null;
  dispositions: unknown;
  is_stale: boolean | null;
  stale_days: number | null;
};

function parseFbaInventoryDispositions(
  raw: unknown,
): FbaInventoryCountryStockRow["dispositions"] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const disposition = String(record.disposition ?? "").trim() || "UNKNOWN";
    const stock = Number(record.stock ?? 0);
    if (!Number.isFinite(stock)) return [];
    return [{ disposition, stock }];
  });
}

/**
 * Fuente canónica UI: latest FBA Inventory Ledger by product/country view.
 * No consulta amazon_fba_inventory_ledger_daily directamente.
 */
export async function fetchLatestFbaInventoryByProductCountry(
  productIds: string[],
): Promise<Map<string, FbaInventoryCountryStockRow[]>> {
  const result = new Map<string, FbaInventoryCountryStockRow[]>();
  if (productIds.length === 0) return result;

  const supabase = createSupabaseRouteClient();

  for (const chunk of chunkArray(productIds, 80)) {
    const { data, error } = await supabase
      .from("v_latest_fba_inventory_by_product_country")
      .select(
        "producto_id, pais, snapshot_date, last_imported_at, stock_fba_sellable, stock_fba_unsellable, stock_fba_physical_total, dispositions, is_stale, stale_days",
      )
      .in("producto_id", chunk)
      .order("pais", { ascending: true });

    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as LatestFbaInventoryByCountryViewRow[]) {
      if (!row.producto_id || !row.pais || !row.snapshot_date) continue;
      const item: FbaInventoryCountryStockRow = {
        productoId: row.producto_id,
        pais: row.pais,
        snapshotDate: row.snapshot_date.slice(0, 10),
        lastImportedAt: row.last_imported_at ?? null,
        stockSellable: Number(row.stock_fba_sellable ?? 0),
        stockUnsellable: Number(row.stock_fba_unsellable ?? 0),
        stockTotal: Number(row.stock_fba_physical_total ?? 0),
        isStale: row.is_stale === true,
        staleDays:
          row.stale_days != null && Number.isFinite(Number(row.stale_days))
            ? Number(row.stale_days)
            : null,
        dispositions: parseFbaInventoryDispositions(row.dispositions),
      };

      const list = result.get(item.productoId) ?? [];
      list.push(item);
      result.set(item.productoId, list);
    }
  }

  for (const [productId, rows] of Array.from(result.entries())) {
    rows.sort((a, b) => a.pais.localeCompare(b.pais));
    result.set(productId, rows);
  }

  return result;
}

export async function fetchLatestFbaInventorySnapshotByProductIds(
  productIds: string[],
): Promise<
  Map<
    string,
    import("../services/resolveOperationalStock").LatestFbaInventorySnapshotStock
  >
> {
  if (productIds.length === 0) return new Map();

  const supabase = createSupabaseRouteClient();
  const snapshotRows: CanonicalInventorySnapshotReadRow[] = [];

  for (const chunk of chunkArray(productIds, 100)) {
    const { data, error } = await supabase
      .from("v_latest_amazon_fba_inventory_snapshot")
      .select(
        "snapshot_run_id, producto_id, snapshot_at, operational_pool, fnsku, seller_sku_aliases, fulfillable_quantity, reserved_quantity, inbound_total_quantity, unfulfillable_quantity, researching_quantity, source",
      )
      .in("producto_id", chunk)
      .in("operational_pool", ["EU", "UK"]);

    if (error) {
      console.error(
        "[inventory] latest FBA inventory snapshot failed",
        error,
        "No se pudo obtener v_latest_amazon_fba_inventory_snapshot. Revisa que la migraciÃ³n SP-API forecast estÃ© aplicada.",
      );
      return new Map();
    }

    snapshotRows.push(...((data ?? []) as CanonicalInventorySnapshotReadRow[]));
  }

  return aggregateCanonicalSnapshotAcrossOperationalPools(snapshotRows);
}
