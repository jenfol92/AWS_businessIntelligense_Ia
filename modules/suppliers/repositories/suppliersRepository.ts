/**
 * Repositorio de proveedores — acceso a `proveedores`, `puertos_china` y `agentes_compra`.
 */

import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type {
  SupplierDeleteBlockReason,
  SupplierEnriched,
  SupplierInput,
  SupplierListFilters,
  SupplierRow,
} from "../types/supplier.types";
import {
  getSupplierIncompleteReasons,
  isSupplierIncomplete,
} from "../utils/supplierCompleteness";

const SUPPLIER_SELECT =
  "id, nombre, pais, ciudad, provincia, puerto_preferido, puerto_preferido_id, " +
  "latitud, longitud, dias_produccion_estandar, dias_transito_estandar, " +
  "deposito_porcentaje, balance_dias_antes_eta, balance_condiciones_texto, " +
  "agente_id, created_at";

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapSupplierRow(raw: Record<string, unknown>): SupplierRow {
  return {
    id: String(raw.id),
    nombre: String(raw.nombre ?? ""),
    pais: (raw.pais as string | null) ?? null,
    ciudad: (raw.ciudad as string | null) ?? null,
    provincia: (raw.provincia as string | null) ?? null,
    puerto_preferido: (raw.puerto_preferido as string | null) ?? null,
    puerto_preferido_id: (raw.puerto_preferido_id as string | null) ?? null,
    latitud: toNumberOrNull(raw.latitud),
    longitud: toNumberOrNull(raw.longitud),
    dias_produccion_estandar:
      raw.dias_produccion_estandar != null
        ? Number(raw.dias_produccion_estandar)
        : null,
    dias_transito_estandar:
      raw.dias_transito_estandar != null
        ? Number(raw.dias_transito_estandar)
        : null,
    deposito_porcentaje: toNumberOrNull(raw.deposito_porcentaje),
    balance_dias_antes_eta:
      raw.balance_dias_antes_eta != null
        ? Number(raw.balance_dias_antes_eta)
        : null,
    balance_condiciones_texto:
      (raw.balance_condiciones_texto as string | null) ?? null,
    agente_id: (raw.agente_id as string | null) ?? null,
    created_at: (raw.created_at as string | null) ?? null,
  };
}

async function fetchPortNamesMap(
  portIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = Array.from(new Set(portIds.filter(Boolean)));
  if (ids.length === 0) return map;

  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("puertos_china")
    .select("id, nombre")
    .in("id", ids);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const r = row as { id: string; nombre: string };
    map.set(r.id, r.nombre);
  }
  return map;
}

async function fetchAgentContactsMap(
  agentIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const ids = Array.from(new Set(agentIds.filter(Boolean)));
  if (ids.length === 0) return map;

  const supabase = createSupabaseRouteClient();
  const { data, error } = await supabase
    .from("agentes_compra")
    .select("id, contacto, empresa")
    .in("id", ids);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const r = row as { id: string; contacto: string | null; empresa: string };
    const label =
      r.contacto?.trim() ||
      r.empresa?.trim() ||
      "Agente sin nombre";
    map.set(r.id, label);
  }
  return map;
}

/** Resuelve nombre de puerto: FK → puertos_china.nombre; fallback texto legacy. */
export function resolvePortDisplayName(
  row: SupplierRow,
  portNames: Map<string, string>,
): string | null {
  if (row.puerto_preferido_id) {
    const fromFk = portNames.get(row.puerto_preferido_id);
    if (fromFk) return fromFk;
  }
  const legacy = row.puerto_preferido?.trim();
  return legacy || null;
}

async function enrichSuppliers(rows: SupplierRow[]): Promise<SupplierEnriched[]> {
  const portIds = rows
    .map((r) => r.puerto_preferido_id)
    .filter((id): id is string => id != null && id !== "");
  const agentIds = rows
    .map((r) => r.agente_id)
    .filter((id): id is string => id != null && id !== "");

  const [portNames, agentContacts] = await Promise.all([
    fetchPortNamesMap(portIds),
    fetchAgentContactsMap(agentIds),
  ]);

  return rows.map((row) => {
    const incompleto_motivos = getSupplierIncompleteReasons(row);
    return {
      ...row,
      puerto_preferido_nombre: resolvePortDisplayName(row, portNames),
      agente_contacto: row.agente_id
        ? (agentContacts.get(row.agente_id) ?? null)
        : null,
      incompleto: incompleto_motivos.length > 0,
      incompleto_motivos,
    };
  });
}

function applyListFilters(
  rows: SupplierEnriched[],
  filters: SupplierListFilters,
): SupplierEnriched[] {
  let result = rows;

  const q = filters.q?.trim().toLowerCase();
  if (q) {
    result = result.filter((r) => {
      const haystack = [r.nombre, r.ciudad, r.provincia, r.pais]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  const pais = filters.pais?.trim().toLowerCase();
  if (pais) {
    result = result.filter((r) =>
      (r.pais ?? "").toLowerCase().includes(pais),
    );
  }

  const puerto = filters.puerto?.trim();
  if (puerto) {
    const lower = puerto.toLowerCase();
    result = result.filter(
      (r) =>
        r.puerto_preferido_id === puerto ||
        (r.puerto_preferido_nombre ?? "").toLowerCase().includes(lower) ||
        (r.puerto_preferido ?? "").toLowerCase().includes(lower),
    );
  }

  const agente = filters.agente?.trim();
  if (agente) {
    result = result.filter((r) => r.agente_id === agente);
  }

  const completitud = filters.completitud?.trim().toLowerCase();
  if (completitud === "complete") {
    result = result.filter((r) => !r.incompleto);
  } else if (completitud === "incomplete") {
    result = result.filter((r) => r.incompleto);
  }

  return result;
}

function inputToDbPayload(input: SupplierInput): Record<string, unknown> {
  return {
    nombre: input.nombre,
    pais: input.pais ?? null,
    ciudad: input.ciudad ?? null,
    provincia: input.provincia ?? null,
    puerto_preferido_id: input.puerto_preferido_id ?? null,
    puerto_preferido: input.puerto_preferido ?? null,
    latitud: input.latitud ?? null,
    longitud: input.longitud ?? null,
    dias_produccion_estandar: input.dias_produccion_estandar ?? null,
    dias_transito_estandar: input.dias_transito_estandar ?? null,
    deposito_porcentaje: input.deposito_porcentaje ?? 30,
    balance_dias_antes_eta: input.balance_dias_antes_eta ?? 10,
    balance_condiciones_texto: input.balance_condiciones_texto ?? null,
    agente_id: input.agente_id ?? null,
  };
}

/** Lista proveedores con enriquecimiento y filtros opcionales. */
export async function listSuppliers(
  filters: SupplierListFilters = {},
): Promise<SupplierEnriched[]> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("proveedores")
    .select(SUPPLIER_SELECT)
    .order("nombre", { ascending: true });

  if (error) throw new Error(error.message);

  const rows = (data ?? []).map((r) =>
    mapSupplierRow(r as unknown as Record<string, unknown>),
  );
  const enriched = await enrichSuppliers(rows);
  return applyListFilters(enriched, filters);
}

/** Obtiene un proveedor por id enriquecido. */
export async function getSupplierById(
  id: string,
): Promise<SupplierEnriched | null> {
  const supabase = createSupabaseRouteClient();

  const { data, error } = await supabase
    .from("proveedores")
    .select(SUPPLIER_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const [enriched] = await enrichSuppliers([
    mapSupplierRow(data as unknown as Record<string, unknown>),
  ]);
  return enriched ?? null;
}

/** Resuelve nombre de puerto al guardar (compatibilidad texto + FK). */
export async function resolvePortNameForId(
  portId: string | null | undefined,
): Promise<string | null> {
  if (!portId) return null;
  const map = await fetchPortNamesMap([portId]);
  return map.get(portId) ?? null;
}

/** Crea un proveedor. */
export async function createSupplier(
  input: SupplierInput,
): Promise<SupplierEnriched> {
  const supabase = createSupabaseRouteClient();

  let puertoTexto = input.puerto_preferido ?? null;
  if (input.puerto_preferido_id && !puertoTexto) {
    puertoTexto = await resolvePortNameForId(input.puerto_preferido_id);
  }

  const payload = inputToDbPayload({
    ...input,
    puerto_preferido: puertoTexto,
  });

  const { data, error } = await supabase
    .from("proveedores")
    .insert(payload)
    .select(SUPPLIER_SELECT)
    .single();

  if (error) throw new Error(error.message);

  const [enriched] = await enrichSuppliers([
    mapSupplierRow(data as unknown as Record<string, unknown>),
  ]);
  if (!enriched) throw new Error("No se pudo leer el proveedor creado.");
  return enriched;
}

/** Actualiza un proveedor existente. */
export async function updateSupplier(
  id: string,
  input: SupplierInput,
): Promise<SupplierEnriched> {
  const supabase = createSupabaseRouteClient();

  let puertoTexto = input.puerto_preferido ?? null;
  if (input.puerto_preferido_id) {
    puertoTexto =
      (await resolvePortNameForId(input.puerto_preferido_id)) ?? puertoTexto;
  } else if (input.puerto_preferido_id === null) {
    puertoTexto = null;
  }

  const payload = inputToDbPayload({
    ...input,
    puerto_preferido: puertoTexto,
  });

  const { data, error } = await supabase
    .from("proveedores")
    .update(payload)
    .eq("id", id)
    .select(SUPPLIER_SELECT)
    .single();

  if (error) throw new Error(error.message);

  const [enriched] = await enrichSuppliers([
    mapSupplierRow(data as unknown as Record<string, unknown>),
  ]);
  if (!enriched) throw new Error("No se pudo leer el proveedor actualizado.");
  return enriched;
}

/** Cuenta referencias antes de borrar. */
export async function countSupplierReferences(
  id: string,
): Promise<SupplierDeleteBlockReason> {
  const supabase = createSupabaseRouteClient();

  const [productos, ordenItems, costos] = await Promise.all([
    supabase
      .from("productos")
      .select("id", { count: "exact", head: true })
      .eq("proveedor_id", id),
    supabase
      .from("orden_items")
      .select("id", { count: "exact", head: true })
      .eq("proveedor_id", id),
    supabase
      .from("producto_costos")
      .select("id", { count: "exact", head: true })
      .eq("proveedor_id", id),
  ]);

  if (productos.error) throw new Error(productos.error.message);
  if (ordenItems.error) throw new Error(ordenItems.error.message);
  if (costos.error) throw new Error(costos.error.message);

  return {
    productos: productos.count ?? 0,
    orden_items: ordenItems.count ?? 0,
    producto_costos: costos.count ?? 0,
  };
}

/** Elimina proveedor si no hay referencias. */
export async function deleteSupplier(id: string): Promise<void> {
  const refs = await countSupplierReferences(id);
  const total = refs.productos + refs.orden_items + refs.producto_costos;

  if (total > 0) {
    const parts: string[] = [];
    if (refs.productos > 0) {
      parts.push(`${refs.productos} producto(s)`);
    }
    if (refs.orden_items > 0) {
      parts.push(`${refs.orden_items} línea(s) de pedido`);
    }
    if (refs.producto_costos > 0) {
      parts.push(`${refs.producto_costos} registro(s) de coste`);
    }
    throw new Error(
      `No se puede eliminar: el proveedor está vinculado a ${parts.join(", ")}.`,
    );
  }

  const supabase = createSupabaseRouteClient();
  const { error } = await supabase.from("proveedores").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** KPIs agregados para el dashboard de proveedores. */
export function computeSupplierStats(rows: SupplierEnriched[]) {
  const total = rows.length;
  const withPort = rows.filter((r) => r.puerto_preferido_nombre).length;
  const withoutPort = total - withPort;
  const withAgent = rows.filter((r) => r.agente_id).length;

  const prodValues = rows
    .map((r) => r.dias_produccion_estandar)
    .filter((v): v is number => v != null && v >= 0);
  const transValues = rows
    .map((r) => r.dias_transito_estandar)
    .filter((v): v is number => v != null && v >= 0);

  const avg = (vals: number[]) =>
    vals.length === 0
      ? null
      : Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);

  return {
    total,
    withPort,
    withoutPort,
    withAgent,
    avgProduction: avg(prodValues),
    avgTransit: avg(transValues),
    incomplete: rows.filter((r) => isSupplierIncomplete(r)).length,
  };
}
