import type { SupabaseClient } from "@supabase/supabase-js";

import {
  mergeOrdersToContainerFields,
  type ContainerFieldsFromOrder,
  type OrderContainerSource,
} from "@/modules/containers/utils/mapOrderToContainerFields";

type OrderRowFromDb = {
  etd: string | null;
  eta: string | null;
  fob_puerto: string | null;
  destino: string | null;
  lead_time_produccion: number | null;
  lead_time_transito: number | null;
  agentes_compra:
    | { contacto: string | null }
    | Array<{ contacto: string | null }>
    | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function mapDbOrderRow(row: OrderRowFromDb): OrderContainerSource {
  const agente = firstRelation(row.agentes_compra);
  return {
    etd: row.etd,
    eta: row.eta,
    fob_puerto: row.fob_puerto,
    destino: row.destino,
    lead_time_produccion: row.lead_time_produccion,
    lead_time_transito: row.lead_time_transito,
    agente_contacto: agente?.contacto ?? null,
  };
}

export async function fetchOrderContainerSources(
  supabase: SupabaseClient,
  ordenIds: string[],
): Promise<OrderContainerSource[]> {
  if (ordenIds.length === 0) return [];

  const { data, error } = await supabase
    .from("ordenes_compra")
    .select(
      "etd, eta, fob_puerto, destino, lead_time_produccion, lead_time_transito, agentes_compra(contacto)",
    )
    .in("id", ordenIds);

  if (error) throw new Error(error.message);
  return ((data ?? []) as OrderRowFromDb[]).map(mapDbOrderRow);
}

export async function resolveContainerFieldsFromOrders(
  supabase: SupabaseClient,
  ordenIds: string[],
): Promise<ContainerFieldsFromOrder> {
  const sources = await fetchOrderContainerSources(supabase, ordenIds);
  return mergeOrdersToContainerFields(sources);
}

type ContainerRowForPropagation = {
  fecha_salida: string | null;
  fecha_eta_estimada: string | null;
  puerto_salida: string | null;
  puerto_llegada: string | null;
  transitario: string | null;
};

/**
 * Rellena campos del contenedor desde órdenes vinculadas.
 * Por defecto solo escribe en campos vacíos (no pisa edición manual).
 */
export async function propagateOrderFieldsToContainer(
  supabase: SupabaseClient,
  contenedorId: string,
  ordenIds: string[],
  onlyEmpty = true,
): Promise<void> {
  if (ordenIds.length === 0) return;

  const fromOrders = await resolveContainerFieldsFromOrders(supabase, ordenIds);

  const { data: contenedor, error: contError } = await supabase
    .from("contenedores")
    .select("fecha_salida, fecha_eta_estimada, puerto_salida, puerto_llegada, transitario")
    .eq("id", contenedorId)
    .single();

  if (contError || !contenedor) return;

  const current = contenedor as ContainerRowForPropagation;
  const updates: Partial<ContainerRowForPropagation> = {};

  const assign = (key: keyof ContainerRowForPropagation) => {
    const nextValue = fromOrders[key];
    if (!nextValue) return;
    const currentValue = current[key];
    const isEmpty = currentValue == null || String(currentValue).trim() === "";
    if (!onlyEmpty || isEmpty) {
      updates[key] = nextValue;
    }
  };

  assign("fecha_salida");
  assign("fecha_eta_estimada");
  assign("puerto_salida");
  assign("puerto_llegada");
  assign("transitario");

  if (Object.keys(updates).length === 0) return;

  await supabase.from("contenedores").update(updates).eq("id", contenedorId);
}

export function enrichCreatePayloadFromOrderFields<
  T extends {
    fecha_salida?: string | null;
    fecha_eta_estimada?: string | null;
    puerto_salida?: string | null;
    puerto_llegada?: string | null;
    transitario?: string | null;
  },
>(payload: T, fromOrders: ContainerFieldsFromOrder): T {
  const isEmpty = (value: string | null | undefined) =>
    value == null || String(value).trim() === "";

  return {
    ...payload,
    fecha_salida: isEmpty(payload.fecha_salida) ? fromOrders.fecha_salida : payload.fecha_salida,
    fecha_eta_estimada: isEmpty(payload.fecha_eta_estimada)
      ? fromOrders.fecha_eta_estimada
      : payload.fecha_eta_estimada,
    puerto_salida: isEmpty(payload.puerto_salida) ? fromOrders.puerto_salida : payload.puerto_salida,
    puerto_llegada: isEmpty(payload.puerto_llegada)
      ? fromOrders.puerto_llegada
      : payload.puerto_llegada,
    transitario: isEmpty(payload.transitario) ? fromOrders.transitario : payload.transitario,
  };
}
