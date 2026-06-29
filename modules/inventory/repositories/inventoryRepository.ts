// modules/inventory/repositories/inventoryRepository.ts
//
// Acceso a Supabase para el módulo Inventario.
// NO calcula reglas de negocio complejas; solo lecturas y agregados básicos.

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import {
  filterRowsByCompetitorSelection,
  resolveSelectionFilterForProduct,
} from "@/modules/products/repositories/productCompetitorBenchmarkSelectionRepository";
import { fetchForecastInboundItems } from "@/modules/planner/repositories/forecastInboundRepository";
import { mapForecastInboundToInventoryRow } from "@/modules/planner/services/mapForecastInboundToInventoryRow";
import type {
  InventoryInboundRow,
  InventoryLoteRow,
  InventoryRow,
  ProductBaseRow,
  SalesAgg,
  SalesByProductCountry,
} from "../types/inventory.types";

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

/** Productos activos para el dashboard de inventario. */
export async function fetchActiveProducts(): Promise<ProductBaseRow[]> {
  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("productos")
    .select(
      "id, sku, nombre, estado, proveedor_id, parent_id, stock_seguridad_minimo",
    )
    .eq("estado", "activo")
    .order("sku", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as ProductBaseRow[];
}

/** Inventario por país para un conjunto de productos. */
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
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 90);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const cutoffWindow = new Date();
  cutoffWindow.setDate(cutoffWindow.getDate() - safeWindow);
  const cutoffWindowStr = cutoffWindow.toISOString().slice(0, 10);
  const cutoff30 = new Date();
  cutoff30.setDate(cutoff30.getDate() - 30);
  const cutoff30Str = cutoff30.toISOString().slice(0, 10);

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
        const curCountry = byProductCountry.get(ck) ?? { units30: 0, units90: 0 };
        curCountry.units90 += units;
        if (row.fecha >= cutoffWindowStr) curCountry.units30 += units;
        byProductCountry.set(ck, curCountry);

        const gk = salesKeyGlobal(pid);
        const curGlobal = byProductGlobal.get(gk) ?? { units30: 0, units90: 0 };
        curGlobal.units90 += units;
        if (row.fecha >= cutoffWindowStr) curGlobal.units30 += units;
        byProductGlobal.set(gk, curGlobal);
      }

      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }

  return { byProductCountry, byProductGlobal };
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

  for (const item of items) {
    const row = mapForecastInboundToInventoryRow(item);
    const list = result.get(item.producto_id) ?? [];
    list.push(row);
    result.set(item.producto_id, list);
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
      throw new Error(
        "No se pudo obtener latest FBA ledger stock. Revisa que la migración get_latest_fba_ledger_stock_by_products esté aplicada.",
      );
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
