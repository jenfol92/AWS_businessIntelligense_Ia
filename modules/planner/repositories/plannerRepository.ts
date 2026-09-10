// modules/planner/repositories/plannerRepository.ts
//
// Fuentes de verdad en el repo (SQL / repositorios existentes):
// - productos, proveedores — productCoreRepository / productSupplierRepository
// - ventas_diarias — productSalesRepository
// - inventario_paises, v_stock_seguridad_sugerido — productInventoryRepository
// - v_productos_catalogo — productCatalogRepository (stock agregado, margen, categoría…)
// - producto_logistica — productLogisticsRepository
//
// Tablas creadas solo en Supabase (sin SQL en el proyecto): producto_restricciones_logisticas,
// seasonality_profiles, product_seasonality, puertos_fabrica, etc. Se consultan con select('*')
// y mapeo defensivo; revisar columnas reales y sustituir helpers marcados con TODO.

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import { fetchForecastInboundByProductIds } from "./forecastInboundRepository";
import {
  fetchSelectionFiltersByProductIds,
  filterRowsByCompetitorSelection,
  getSelectionFilterForProduct,
} from "@/modules/products/repositories/productCompetitorBenchmarkSelectionRepository";
import type { CompetitorSelectionFilterResult } from "@/modules/products/types/competitor-benchmark-selection.types";
import type {
  CompetitorBenchmarkRow,
  PlannerLogisticsRestriction,
  PlannerParams,
  PlanningProduct,
} from "../types/planner.types";

const DEFAULT_WINDOW_DAYS = 90;
const DEFAULT_SEASONALITY = "evergreen";

const DEFAULT_LOGISTICS_RESTRICTION: PlannerLogisticsRestriction = {
  contieneBaterias: false,
  tipoBateria: null,
  unNumber: null,
  claseMercanciaPeligrosa: null,
  requiereDgd: false,
  requiereAprobacionTransportista: false,
  permiteConsolidacionMixta: true,
  forzarEnvioSeparado: false,
  allowsConsolidation: true,
};
type SalesTotals = { units: number; amount: number };
type CatalogPlanningRow = {
  producto_id: string;
  categoria_id?: string | null;
  marca: string | null;
  stock_fba: number | null;
  stock_fbm: number | null;
  stock_total: number | null;
  precio_venta_objetivo: number | null;
  costo_total_estimado: number | null;
  margen_estimado: number | null;
  puerto_preferido: string | null;
  proveedor_nombre: string | null;
};

export type SupplierRow = {
  id: string;
  nombre: string | null;
  /** Nombre legible del puerto (columna texto en proveedores). */
  puerto_preferido: string | null;
  puerto_preferido_id: string | null;
  dias_produccion_estandar: number | null;
  dias_transito_estandar: number | null;
  agente_id: string | null;
};

type ProductBaseRow = {
  id: string;
  sku: string | null;
  nombre: string | null;
  asin: string | null;
  proveedor_id: string | null;
  estado: string | null;
  parent_id: string | null;
};

type LogisticaRow = {
  producto_id: string;
  pedido_minimo_unidades: number | null;
  unidades_por_caja: number | null;
  cubicaje_unitario_m3: number | null;
  peso_kg_bruto: number | null;
};

type OperationalStockRow = {
  producto_id: string;
  stock_fba_total: number | null;
  observed_at: string | null;
  dual_pool_complete: boolean | null;
};

function resolveWindowDays(params: PlannerParams): number {
  return params.windowDays ?? DEFAULT_WINDOW_DAYS;
}

/** `ventas_diarias.canal_venta` usa valores como `FBA` / `FBM` (ver migraciones Amazon). */
function ventasCanalFromPlannerParams(
  channel: PlannerParams["channel"],
): string | null {
  if (!channel || channel === "ALL") return null;
  if (channel === "AMAZON_FBA") return "FBA";
  if (channel === "AMAZON_FBM") return "FBM";
  return null;
}

/**
 * Etiqueta obligatoria en `PlanningProduct.channel` cuando el filtro es `ALL`:
 * se agregan ventas de todos los canales pero el campo queda en `AMAZON_FBA` por compatibilidad.
 */
function planningChannelLabel(params: PlannerParams): "AMAZON_FBA" | "AMAZON_FBM" {
  if (params.channel === "AMAZON_FBM") return "AMAZON_FBM";
  return "AMAZON_FBA";
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function pickPrincipalFactoryPortRow(
  rows: Record<string, unknown>[],
): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  const marked = rows.find((r) =>
    Object.entries(r).some(
      ([k, v]) =>
        typeof v === "boolean" &&
        /principal|preferid|primary|default|predeterminad/i.test(k) &&
        v,
    ),
  );
  return marked ?? rows[0];
}

/**
 * TODO: Sustituir por columnas confirmadas en `puertos_fabrica` / `puerto_china`
 * cuando estén documentadas en el repo (evita heurística por nombre de campo).
 */
function extractPortIdFromPuertoFabricaRow(
  row: Record<string, unknown>,
): string | null {
  const skip = new Set([
    "id",
    "proveedor_id",
    "fabrica_id",
    "puerto_id",
    "created_at",
    "updated_at",
    "distance_km_road",
    "distance_km_straight",
  ]);
  for (const [k, v] of Object.entries(row)) {
    if (skip.has(k) || v == null) continue;
    if (typeof v === "string" || typeof v === "number") {
      if (/puerto/i.test(k) && !/proveedor|fabric/.test(k)) {
        return String(v);
      }
    }
  }
  return null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Prioriza `puerto_id` de `puertos_fabrica`; mantiene heurística como respaldo. */
function portIdFromPuertoFabricaRow(row: Record<string, unknown>): string | null {
  const raw = row.puerto_id;
  if (raw !== undefined && raw !== null && raw !== "") {
    if (typeof raw === "string" && raw.trim()) return raw.trim();
    if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  }
  return extractPortIdFromPuertoFabricaRow(row);
}

type OriginPortInfo = {
  originPortId: string | null;
  originPortDistanceKmRoad: number | null;
  originPortDistanceKmStraight: number | null;
};

function resolveOriginPortInfo(args: {
  supplierId: string | null;
  catalog: CatalogPlanningRow | undefined;
  supplier: SupplierRow | undefined;
  puertosFabrica: Map<string, Record<string, unknown>[]>;
}): OriginPortInfo {
  const { supplierId, catalog, supplier, puertosFabrica } = args;

  if (supplierId) {
    const fabRows = puertosFabrica.get(supplierId) ?? [];
    const picked = pickPrincipalFactoryPortRow(fabRows);
    if (picked) {
      const fromFab = portIdFromPuertoFabricaRow(picked);
      if (fromFab) {
        return {
          originPortId: fromFab,
          originPortDistanceKmRoad: toNullableNumber(
            picked.distance_km_road,
          ),
          originPortDistanceKmStraight: toNullableNumber(
            picked.distance_km_straight,
          ),
        };
      }
    }
  }

  return {
    originPortId:
      supplier?.puerto_preferido_id ?? catalog?.puerto_preferido ?? null,
    originPortDistanceKmRoad: null,
    originPortDistanceKmStraight: null,
  };
}

function mapLogisticsRestrictionRow(
  row: Record<string, unknown> | undefined,
): PlannerLogisticsRestriction {
  if (!row) return DEFAULT_LOGISTICS_RESTRICTION;

  const permiteConsolidacionMixta =
    row.permite_consolidacion_mixta == null
      ? true
      : Boolean(row.permite_consolidacion_mixta);

  const forzarEnvioSeparado = Boolean(row.forzar_envio_separado ?? false);

  return {
    contieneBaterias: Boolean(row.contiene_baterias ?? false),
    tipoBateria: (row.tipo_bateria as string | null) ?? null,
    unNumber: (row.un_number as string | null) ?? null,
    claseMercanciaPeligrosa:
      (row.clase_mercancia_peligrosa as string | null) ?? null,
    requiereDgd: Boolean(row.requiere_dgd ?? false),
    requiereAprobacionTransportista: Boolean(
      row.requiere_aprobacion_transportista ?? false,
    ),
    permiteConsolidacionMixta,
    forzarEnvioSeparado,
    allowsConsolidation: permiteConsolidacionMixta && !forzarEnvioSeparado,
  };
}

function extractProfileIdFromSeasonalityLinkRow(
  row: Record<string, unknown>,
): string | null {
  for (const [k, v] of Object.entries(row)) {
    if (typeof v !== "string" || !v) continue;
    if (/profile|perfil/i.test(k) && !/producto/i.test(k)) return v;
  }
  return null;
}

/**
 * TODO: Ajustar a columnas reales (`nombre`, `slug`, etc.) en `seasonality_profiles`.
 */
function seasonalityLabelFromProfileRow(row: Record<string, unknown>): string {
  for (const [k, v] of Object.entries(row)) {
    if (typeof v !== "string" || !v.trim()) continue;
    if (/nombre|slug|code|key|label|tipo/i.test(k)) return v.trim();
  }
  return DEFAULT_SEASONALITY;
}

async function fetchProductsBase(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  params: PlannerParams,
  signal?: AbortSignal,
): Promise<ProductBaseRow[]> {
  const estados = params.includeNewProducts
    ? (["activo", "borrador"] as const)
    : (["activo"] as const);

    let query = supabase
    .from("productos")
    .select(
      "id, sku, nombre, asin, proveedor_id, estado, parent_id",
    )
    .in("estado", [...estados]);

    if (params.productIds?.length) {
      query = query.in("id", params.productIds);
    }

    if (signal) {
      query = query.abortSignal(signal);
    }

  const { data, error } = await query;

  if (error) throw new Error(error.message);
  return (data ?? []) as ProductBaseRow[];
}

export async function fetchSuppliersMap(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  supplierIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, SupplierRow>> {
  const map = new Map<string, SupplierRow>();
  if (supplierIds.length === 0) return map;

  for (const chunk of chunkArray(supplierIds, 200)) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    let query = supabase
      .from("proveedores")
      .select(
        "id, nombre, puerto_preferido_id, dias_produccion_estandar, dias_transito_estandar, agente_id",
      )
      .in("id", chunk);

    if (signal) {
      query = query.abortSignal(signal);
    }

    const { data, error } = await query;

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      map.set((row as SupplierRow).id, row as SupplierRow);
    }
  }

  return map;
}

export async function fetchAgentsMap(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  agentIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, { id: string; empresa: string | null; contacto: string | null }>> {
  const map = new Map<string, { id: string; empresa: string | null; contacto: string | null }>();
  if (agentIds.length === 0) return map;

  for (const chunk of chunkArray(agentIds, 200)) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

     let query = supabase
      .from("agentes_compra")
      .select("id, empresa, contacto")
      .in("id", chunk);

      if (signal) {
        query = query.abortSignal(signal);
      }
      const { data, error } = await query;

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const r = row as { id: string; empresa: string | null; contacto: string | null };
      map.set(r.id, { id: r.id, empresa: r.empresa, contacto: r.contacto });
    }
  }
  return map;
}

const UNKNOWN_PORT_KEY = "UNKNOWN_PORT";

/**
 * Resuelve nombres legibles de puertos desde puertos_china.
 * Nunca devuelve UUID como valor visible.
 */
export async function fetchPortNamesMap(
  portIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const validIds = portIds.filter(
    (id) => id && id !== UNKNOWN_PORT_KEY && id.length > 8,
  );
  if (validIds.length === 0) return map;

  const supabase = createSupabaseRouteClient();
  for (const chunk of chunkArray(validIds, 200)) {
    const { data, error } = await supabase
      .from("puertos_china")
      .select("id, nombre, code")
      .in("id", chunk);

    if (error) {
      console.warn(`[planner] puertos_china omitido: ${error.message}`);
      continue;
    }
    for (const row of data ?? []) {
      const r = row as { id: string; nombre: string | null; code: string | null };
      const name = (r.nombre ?? r.code ?? "").trim();
      if (r.id && name) map.set(r.id, name);
    }
  }
  return map;
}

export function resolvePortDisplayName(
  portId: string | null | undefined,
  portNames: Map<string, string>,
): string {
  if (!portId || portId === UNKNOWN_PORT_KEY) return "Puerto sin definir";
  return portNames.get(portId) ?? "Puerto sin definir";
}

/** Puerto preferido del proveedor (nunca devuelve UUID como nombre visible). */
export function resolveSupplierPreferredPort(
  supplierId: string | null | undefined,
  suppliersMap: Map<string, SupplierRow>,
  portNames: Map<string, string>,
): { id: string | null; name: string } {
  if (!supplierId) return { id: null, name: "Puerto pendiente" };
  const supplier = suppliersMap.get(supplierId);
  const id = supplier?.puerto_preferido_id ?? null;
  if (!id) return { id: null, name: "Puerto pendiente" };
  const name = portNames.get(id);
  return { id, name: name?.trim() ? name : "Puerto pendiente" };
}

/** Distancia fábrica → puerto desde puertos_fabrica (km por carretera o recta). */
export function resolveSupplierDistanceToPort(
  supplierId: string | null | undefined,
  portId: string | null | undefined,
  puertosFabrica: Map<string, Record<string, unknown>[]>,
  fallbackPreferredPortId?: string | null,
  fallbackDistanceKm?: number | null,
): number | null {
  if (!supplierId || !portId) return null;
  const rows = puertosFabrica.get(supplierId) ?? [];
  for (const row of rows) {
    const rowPortId = portIdFromPuertoFabricaRow(row);
    if (rowPortId === portId) {
      return (
        toNullableNumber(row.distance_km_road) ??
        toNullableNumber(row.distance_km_straight)
      );
    }
  }
  if (
    fallbackPreferredPortId &&
    portId === fallbackPreferredPortId &&
    fallbackDistanceKm != null
  ) {
    return fallbackDistanceKm;
  }
  return null;
}

/** Filas puertos_fabrica por proveedor/fábrica (para cálculo de puerto óptimo de grupo). */
export async function fetchPuertosFabricaBySupplier(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  supplierIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, Record<string, unknown>[]>> {
  const map = new Map<string, Record<string, unknown>[]>();
  const unique = Array.from(new Set(supplierIds.filter(Boolean)));
  if (unique.length === 0) return map;

  let query = supabase
    .from("puertos_fabrica")
    .select("*")
    .in("fabrica_id", unique);
    if (signal) {
      query = query.abortSignal(signal);
    }

  const { data, error } = await query;

  if (error) {
    console.warn(`[planner] puertos_fabrica omitido: ${error.message}`);
    return map;
  }

  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const sid = r.fabrica_id as string | undefined;
    if (!sid) continue;
    const arr = map.get(sid) ?? [];
    arr.push(r);
    map.set(sid, arr);
  }
  return map;
}

export function resolveAgentContact(
  agentId: string | null | undefined,
  agents: Map<string, { id: string; empresa: string | null; contacto: string | null }>,
): string {
  if (!agentId) return "Sin agente";
  const ag = agents.get(agentId);
  if (!ag) return "Sin agente";
  const contact = (ag.contacto ?? "").trim();
  if (contact) return contact;
  const empresa = (ag.empresa ?? "").trim();
  return empresa || "Sin agente";
}

/** Ventas últimos 30 y 90 días para detectar picos (unidades). */
export async function fetchSales30And90Days(
  productIds: string[],
  country: string | undefined,
  canal: string | null,
): Promise<Map<string, { sales30: number; sales90: number }>> {
  const [map30, map90] = await Promise.all([
    fetchSalesTotals(
      createSupabaseRouteClient(),
      productIds,
      30,
      country,
      canal,
    ),
    fetchSalesTotals(
      createSupabaseRouteClient(),
      productIds,
      90,
      country,
      canal,
    ),
  ]);

  const out = new Map<string, { sales30: number; sales90: number }>();
  for (const id of productIds) {
    out.set(id, {
      sales30: map30.get(id)?.units ?? 0,
      sales90: map90.get(id)?.units ?? 0,
    });
  }
  return out;
}

async function fetchPlanningCatalogRows(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  productIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, CatalogPlanningRow>> {
  const map = new Map<string, CatalogPlanningRow>();

  for (const chunk of chunkArray(productIds, 200)) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    let query = supabase
      .from("v_productos_catalogo")
      .select(
        `
        producto_id,
        marca,
        stock_fba,
        stock_fbm,
        stock_total,
        precio_venta_objetivo,
        costo_total_estimado,
        margen_estimado,
        puerto_preferido,
        proveedor_nombre
      `,
      )
      .in("producto_id", chunk);

      if (signal) {
        query = query.abortSignal(signal);
      }
      const { data, error } = await query;

    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as CatalogPlanningRow[]) {
      map.set(row.producto_id, row);
    }
  }
  return map;
}

async function fetchOperationalFbaStockMap(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  productIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, OperationalStockRow>> {
  const map = new Map<string, OperationalStockRow>();
  for (const chunk of chunkArray(productIds, 200)) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    let query = supabase
      .from("v_latest_amazon_fba_inventory_by_product_operational_total")
      .select("producto_id,stock_fba_total,observed_at,dual_pool_complete")
      .in("producto_id", chunk);

      if (signal) {
        query = query.abortSignal(signal);
      }

      const { data, error } = await query;

    if (error) {
      console.warn(`[planner] stock FBA operativo no disponible: ${error.message}`);
      return new Map();
    }
    for (const row of data ?? []) {
      const item = row as OperationalStockRow;
      if (item.producto_id) map.set(item.producto_id, item);
    }
  }
  return map;
}

async function fetchStockFallbackTotals(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  productIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (productIds.length === 0) return map;

  for (const chunk of chunkArray(productIds, 200)) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    let query = supabase
      .from("inventario_paises")
      .select("producto_id, stock_fba, stock_fbm")
      .in("producto_id", chunk);

      if (signal) {
        query = query.abortSignal(signal);
      }
      const { data, error } = await query;

    if (error) throw new Error(error.message);

    for (const row of data ?? []) {
      const pid = row.producto_id as string;
      const add =
        Number(row.stock_fba ?? 0) + Number(row.stock_fbm ?? 0);
      map.set(pid, (map.get(pid) ?? 0) + add);
    }
  }
  return map;
}

async function fetchSalesTotals(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  productIds: string[],
  windowDays: number,
  country: string | undefined,
  canal: string | null,
  signal?: AbortSignal,
): Promise<Map<string, SalesTotals>> {
  const result = new Map<string, SalesTotals>();
  if (productIds.length === 0) return result;

  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - windowDays);
  const fromStr = fromDate.toISOString().slice(0, 10);
  const pageSize = 1000;

  for (const idChunk of chunkArray(productIds, 120)) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    let offset = 0;
    for (;;) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      let q = supabase
        .from("ventas_diarias")
        .select("producto_id, unidades_vendidas, ingresos_brutos")
        .gte("fecha", fromStr)
        .in("producto_id", idChunk)
        .order("fecha", { ascending: true })
        .order("producto_id", { ascending: true })
        .range(offset, offset + pageSize - 1);

      if (country && country !== "ALL") q = q.eq("pais", country);
      if (canal) q = q.eq("canal_venta", canal);
      if (signal) {
        q = q.abortSignal(signal);
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const rows = data ?? [];
      for (const row of rows) {
        const pid = row.producto_id as string;
        const cur = result.get(pid) ?? { units: 0, amount: 0 };
        cur.units += Number(row.unidades_vendidas ?? 0);
        cur.amount += Number(row.ingresos_brutos ?? 0);
        result.set(pid, cur);
      }

      if (rows.length < pageSize) break;
      offset += pageSize;
    }
  }

  return result;
}

async function fetchProductoLogisticaMap(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  productIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, LogisticaRow>> {
  const map = new Map<string, LogisticaRow>();
  if (productIds.length === 0) return map;

  for (const chunk of chunkArray(productIds, 200)) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  let query = supabase
      .from("producto_logistica")
      .select(
        "producto_id, pedido_minimo_unidades, unidades_por_caja, cubicaje_unitario_m3, peso_kg_bruto",
      )
      .in("producto_id", chunk);
      if (signal) {
        query = query.abortSignal(signal);
      }

      const { data, error } = await query;

    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      map.set((row as LogisticaRow).producto_id, row as LogisticaRow);
    }
  }
  return map;
}

/** TODO: Confirmar columnas y semántica (`producto_id`, flags consolidación, etc.). */
async function fetchRestrictionsByProduct(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  productIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, Record<string, unknown>>> {
  const map = new Map<string, Record<string, unknown>>();
  if (productIds.length === 0) return map;

  for (const chunk of chunkArray(productIds, 200)) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    let query = supabase
      .from("producto_restricciones_logisticas")
      .select("*")
      .in("producto_id", chunk);
      
      if (signal) {
        query = query.abortSignal(signal);
      }
      const { data, error } = await query;
    if (error) {
      console.warn(
        `[planner] producto_restricciones_logisticas omitido: ${error.message}`,
      );
      return map;
    }

    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      const pid = r.producto_id as string | undefined;
      if (pid) map.set(pid, r);
    }
  }
  return map;
}

/** TODO: Confirmar grano y FKs hacia `seasonality_profiles`. */
async function fetchSeasonalityLabels(
  supabase: ReturnType<typeof createSupabaseRouteClient>,
  productIds: string[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (productIds.length === 0) return out;

  const linkRows: Record<string, unknown>[] = [];

  for (const chunk of chunkArray(productIds, 200)) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    let query = supabase
   
      .from("product_seasonality")
      .select("*")
      .in("producto_id", chunk);

      if (signal) {
        query = query.abortSignal(signal);
      }

    const { data, error } = await query;
    if (error) {
      console.warn(`[planner] product_seasonality omitido: ${error.message}`);
      return out;
    }
    linkRows.push(...((data ?? []) as Record<string, unknown>[]));
  }

  const profileIds = new Set<string>();
  const productToProfile = new Map<string, string>();

  for (const row of linkRows) {
    const pid = row.producto_id as string | undefined;
    const prof = extractProfileIdFromSeasonalityLinkRow(row);
    if (pid && prof) {
      productToProfile.set(pid, prof);
      profileIds.add(prof);
    }
  }

  const profiles = new Map<string, Record<string, unknown>>();
  if (profileIds.size > 0) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    let query = supabase
      .from("seasonality_profiles")
      .select("*")
      .in("id", Array.from(profileIds));
      if (signal) {
        query = query.abortSignal(signal);
      }
      const { data, error } = await query;
    if (error) {
      console.warn(
        `[planner] seasonality_profiles omitido: ${error.message}`,
      );
      productToProfile.forEach((_prof, pid) => {
        out.set(pid, DEFAULT_SEASONALITY);
      });
      return out;
    }
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      const id = r.id as string | undefined;
      if (id) profiles.set(id, r);
    }
  }

  productToProfile.forEach((profId, pid) => {
    const pr = profiles.get(profId);
    out.set(
      pid,
      pr ? seasonalityLabelFromProfileRow(pr) : DEFAULT_SEASONALITY,
    );
  });

  return out;
}

const COMPETITOR_BENCHMARK_CHUNK = 150;

const COMPETITOR_BENCHMARK_SELECT = [
  "producto_id",
  "candidate_sku",
  "marketplace_country",
  "competitor_asin",
  "competitor_title",
  "snapshot_date",
  "price",
  "rating",
  "review_count",
  "estimated_monthly_units",
  "estimated_monthly_revenue",
  "bsr",
  "source",
].join(",");

function mapCompetitorBenchmarkSnapshotRow(
  row: Record<string, unknown>,
): CompetitorBenchmarkRow {
  const productoIdRaw = row.producto_id;
  const candidateSkuRaw = row.candidate_sku;

  return {
    productoId:
      productoIdRaw === undefined ||
      productoIdRaw === null ||
      String(productoIdRaw).trim() === ""
        ? null
        : String(productoIdRaw).trim(),
    candidateSku:
      candidateSkuRaw === undefined ||
      candidateSkuRaw === null ||
      String(candidateSkuRaw).trim() === ""
        ? null
        : String(candidateSkuRaw).trim(),
    marketplaceCountry: String(row.marketplace_country ?? ""),
    competitorAsin: String(row.competitor_asin ?? ""),
    competitorTitle:
      row.competitor_title == null ? null : String(row.competitor_title),
    snapshotDate: String(row.snapshot_date ?? ""),
    price: toNullableNumber(row.price),
    rating: toNullableNumber(row.rating),
    reviewCount: toNullableNumber(row.review_count),
    estimatedMonthlyUnits: toNullableNumber(row.estimated_monthly_units),
    estimatedMonthlyRevenue: toNullableNumber(row.estimated_monthly_revenue),
    bsr: toNullableNumber(row.bsr),
    source: String(row.source ?? ""),
  };
}

function competitorBenchmarkDedupeKey(r: CompetitorBenchmarkRow): string {
  return [
    r.productoId ?? "",
    r.candidateSku ?? "",
    r.competitorAsin,
    r.snapshotDate,
    r.marketplaceCountry,
  ].join("|");
}

function benchmarkGroupKey(r: CompetitorBenchmarkRow): string | null {
  const pid = r.productoId?.trim();
  if (pid) return pid;
  const sku = r.candidateSku?.trim();
  if (sku) return sku;
  return null;
}

function ingestCompetitorBenchmarkRows(
  target: Map<string, CompetitorBenchmarkRow[]>,
  seen: Set<string>,
  rawRows: Record<string, unknown>[],
  selectionFiltersByProductId?: Map<string, CompetitorSelectionFilterResult>,
) {
  for (const raw of rawRows) {
    const row = mapCompetitorBenchmarkSnapshotRow(raw);
    const productoId = row.productoId?.trim();
    if (selectionFiltersByProductId && productoId) {
      const filter = getSelectionFilterForProduct(
        selectionFiltersByProductId,
        productoId,
      );
      const filtered = filterRowsByCompetitorSelection(
        [row],
        (r) => r.competitorAsin,
        filter,
      );
      if (filtered.length === 0) continue;
    }

    const dk = competitorBenchmarkDedupeKey(row);
    if (seen.has(dk)) continue;
    seen.add(dk);
    const key = benchmarkGroupKey(row);
    if (!key) continue;
    const arr = target.get(key) ?? [];
    arr.push(row);
    target.set(key, arr);
  }
}

/**
 * Benchmarks de competidores para planificación (Motor A.2).
 * Agrupa por `productoId` si existe; si no, por `candidateSku`.
 */
export async function getCompetitorBenchmarksForPlanning(
  productIds: string[],
  candidateSkus: string[],
  country?: string,
): Promise<Map<string, CompetitorBenchmarkRow[]>> {
  const uniqueProductIds = Array.from(
    new Set(
      productIds.map((id) => String(id).trim()).filter((id) => id.length > 0),
    ),
  );
  const uniqueCandidateSkus = Array.from(
    new Set(
      candidateSkus.map((s) => String(s).trim()).filter((s) => s.length > 0),
    ),
  );

  if (uniqueProductIds.length === 0 && uniqueCandidateSkus.length === 0) {
    return new Map();
  }

  try {
    const supabase = createSupabaseRouteClient();
    const result = new Map<string, CompetitorBenchmarkRow[]>();
    const seen = new Set<string>();

    const marketplaceCountry =
      country && country !== "ALL" ? country.trim() : null;

    let selectionFiltersByProductId:
      | Map<string, CompetitorSelectionFilterResult>
      | undefined;
    if (marketplaceCountry && uniqueProductIds.length > 0) {
      try {
        selectionFiltersByProductId = await fetchSelectionFiltersByProductIds(
          uniqueProductIds,
          marketplaceCountry,
        );
      } catch (selectionError) {
        const message =
          selectionError instanceof Error
            ? selectionError.message
            : String(selectionError);
        console.warn(
          `[planner] product_competitor_benchmark_selection omitido: ${message}`,
        );
      }
    }

    for (const chunk of chunkArray(uniqueProductIds, COMPETITOR_BENCHMARK_CHUNK)) {
      let q = supabase
        .from("competitor_benchmark_snapshots")
        .select(COMPETITOR_BENCHMARK_SELECT)
        .in("producto_id", chunk);
      if (marketplaceCountry) {
        q = q.eq("marketplace_country", marketplaceCountry);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      ingestCompetitorBenchmarkRows(
        result,
        seen,
        (data ?? []) as unknown as Record<string, unknown>[],
        selectionFiltersByProductId,
      );
    }

    for (const chunk of chunkArray(
      uniqueCandidateSkus,
      COMPETITOR_BENCHMARK_CHUNK,
    )) {
      let q = supabase
        .from("competitor_benchmark_snapshots")
        .select(COMPETITOR_BENCHMARK_SELECT)
        .in("candidate_sku", chunk);
      if (marketplaceCountry) {
        q = q.eq("marketplace_country", marketplaceCountry);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      ingestCompetitorBenchmarkRows(
        result,
        seen,
        (data ?? []) as unknown as Record<string, unknown>[],
        selectionFiltersByProductId,
      );
    }

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.warn(
      `[planner] competitor_benchmark_snapshots omitido: ${message}`,
    );
    return new Map();
  }
}

export async function getProductsForPlanning(
  params: PlannerParams,
  signal?: AbortSignal,
): Promise<PlanningProduct[]> {
  const supabase = createSupabaseRouteClient();
  const windowDays = resolveWindowDays(params);
  const country = params.country ?? "ALL";
  const canal = ventasCanalFromPlannerParams(params.channel);
  const channelLabel = planningChannelLabel(params);

  const products = await fetchProductsBase(
    supabase,
    params,
    signal,
  );

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const productIds = products.map((p) => p.id);

  const supplierIds = Array.from(
    new Set(
      products
        .map((p) => p.proveedor_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const [
    supplierMap,
    catalogMap,
    salesMap,
    logisticaMap,
    puertosFabrica,
    restrictionsMap,
    seasonalityMap,
    operationalFbaStockMap,
  ] = await Promise.all([
    fetchSuppliersMap(
      supabase,
      supplierIds,
      signal,
    ),
    fetchPlanningCatalogRows(
      supabase,
      productIds,
      signal,
    ),
    fetchSalesTotals(
      supabase,
      productIds,
      windowDays,
      country,
      canal,
      signal,
    ),
    fetchProductoLogisticaMap(
      supabase,
      productIds,
      signal,
    ),
    fetchPuertosFabricaBySupplier(
      supabase,
      supplierIds,
      signal,
    ),
    fetchRestrictionsByProduct(
      supabase,
      productIds,
      signal,
    ),
    fetchSeasonalityLabels(
      supabase,
      productIds,
      signal,
    ),
    fetchOperationalFbaStockMap(
      supabase,
      productIds,
      signal,
    ),
  ]);

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const agentIds = Array.from(
    new Set(
      Array.from(supplierMap.values())
        .map((s) => s.agente_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const agentsMap = await fetchAgentsMap(
    supabase,
    agentIds,
    signal,
  );

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const needsStockFallback = productIds.filter((id) => {
    const c = catalogMap.get(id);
    return c == null || c.stock_total == null;
  });

  const stockFallback =
    needsStockFallback.length > 0
      ? await fetchStockFallbackTotals(
          supabase,
          needsStockFallback,
          signal,
        )
      : new Map<string, number>();

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const inboundByProduct =
    productIds.length > 0
      ? await fetchForecastInboundByProductIds(productIds)
      : new Map();

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const planningProducts: PlanningProduct[] = products.map((p) => {
    const catalog = catalogMap.get(p.id);
    const sup = p.proveedor_id ? supplierMap.get(p.proveedor_id) : undefined;
    const sales = salesMap.get(p.id) ?? { units: 0, amount: 0 };
    const log = logisticaMap.get(p.id);
    const restrRow = restrictionsMap.get(p.id);
    const restriction = mapLogisticsRestrictionRow(restrRow);

    let stockTotal = 0;
    const operationalFba = operationalFbaStockMap.get(p.id);
    if (operationalFba) {
      stockTotal = Number(operationalFba.stock_fba_total ?? 0) + Number(catalog?.stock_fbm ?? 0);
    } else if (catalog?.stock_total != null) {
      stockTotal = Number(catalog.stock_total);
    } else {
      stockTotal = stockFallback.get(p.id) ?? 0;
    }

    const originPortInfo = resolveOriginPortInfo({
      supplierId: p.proveedor_id,
      catalog,
      supplier: sup,
      puertosFabrica,
    });

    const seasonalityProfile =
      seasonalityMap.get(p.id) ?? DEFAULT_SEASONALITY;

    const inboundSummary = inboundByProduct.get(p.id);

    const item: PlanningProduct = {
      id: p.id,
      sku: p.sku ?? "",
      nombre: p.nombre ?? undefined,
      asin: p.asin,

      country,
      channel: channelLabel,

      categoryId: catalog?.categoria_id ?? null,
      brand: catalog?.marca ?? null,

      salesUnits: sales.units,
      salesAmount: sales.amount,
      windowDays,

      stockTotal,
      stockReserved: undefined,
      stockInboundConfirmed: inboundSummary?.stockInboundConfirmed ?? 0,
      stockInboundProvisional: inboundSummary?.stockInboundProvisional ?? 0,
      stockInboundPlanned: undefined,
      inboundSchedule: inboundSummary?.schedule ?? [],
      capitalAlreadyCommitted: inboundSummary?.capitalAlreadyCommitted ?? 0,

      purchaseCost: catalog?.costo_total_estimado ?? undefined,
      salePrice: catalog?.precio_venta_objetivo ?? undefined,
      marginPct: catalog?.margen_estimado ?? undefined,

      supplierId: p.proveedor_id,
      supplierName:
        catalog?.proveedor_nombre ?? sup?.nombre ?? null,
      agentId: sup?.agente_id ?? null,
      agentName: sup?.agente_id
        ? agentsMap.get(sup.agente_id)?.empresa ?? null
        : null,
      factoryId: p.proveedor_id,
      originPortId: originPortInfo.originPortId,
      originPortDistanceKmRoad: originPortInfo.originPortDistanceKmRoad,
      originPortDistanceKmStraight: originPortInfo.originPortDistanceKmStraight,

      leadTimeProductionDays: sup?.dias_produccion_estandar ?? undefined,
      leadTimeSeaDays: sup?.dias_transito_estandar ?? undefined,
      leadTimeLandDays: undefined,

      moq: log?.pedido_minimo_unidades ?? null,
      cartonMultiple: log?.unidades_por_caja ?? null,
      cbmPerUnit: log?.cubicaje_unitario_m3 ?? null,
      weightKg: log?.peso_kg_bruto ?? null,

      isNewProduct: p.estado === "borrador",
      launchDate: null,
      seasonalityProfile,
      familyKey: p.parent_id,

      logisticsRestriction: restriction,
    };

    return item;
  });

  return planningProducts;
}
