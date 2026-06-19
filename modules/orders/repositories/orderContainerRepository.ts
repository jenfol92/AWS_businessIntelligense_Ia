import type { SupabaseClient } from "@supabase/supabase-js";

import type { OrderLinkedContainer } from "@/modules/orders/types/orderList.types";

type ContainerLinkRow = {
  orden_id: string;
  contenedor_id: string;
  contenedores:
    | {
        id: string;
        identificador_embarque: string | null;
        fecha_eta_estimada: string | null;
        estado_logistico: string | null;
        puerto_llegada: string | null;
      }
    | Array<{
        id: string;
        identificador_embarque: string | null;
        fecha_eta_estimada: string | null;
        estado_logistico: string | null;
        puerto_llegada: string | null;
      }>
    | null;
};

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export type OrderContainerAssignment = {
  orden_id: string;
  contenedor_id: string;
  identificador_embarque: string;
};

export async function fetchContainerInfoByOrderIds(
  supabase: SupabaseClient,
  orderIds: string[],
): Promise<Map<string, OrderLinkedContainer>> {
  const map = new Map<string, OrderLinkedContainer>();
  if (orderIds.length === 0) return map;

  const { data, error } = await supabase
    .from("contenedor_ordenes")
    .select(
      `orden_id, contenedor_id,
       contenedores(id, identificador_embarque, fecha_eta_estimada, estado_logistico, puerto_llegada)`,
    )
    .in("orden_id", orderIds);

  if (error) throw new Error(error.message);

  for (const row of (data ?? []) as ContainerLinkRow[]) {
    const container = firstRelation(row.contenedores);
    if (!container) continue;
    map.set(row.orden_id, {
      contenedor_id: row.contenedor_id,
      identificador_embarque: container.identificador_embarque?.trim() || row.contenedor_id.slice(0, 8),
      fecha_eta_estimada: container.fecha_eta_estimada,
      estado_logistico: container.estado_logistico,
      puerto_llegada: container.puerto_llegada,
    });
  }

  return map;
}

export async function fetchOrderContainerAssignments(
  supabase: SupabaseClient,
  ordenIds: string[],
): Promise<OrderContainerAssignment[]> {
  if (ordenIds.length === 0) return [];

  const { data, error } = await supabase
    .from("contenedor_ordenes")
    .select(
      `orden_id, contenedor_id, contenedores(identificador_embarque)`,
    )
    .in("orden_id", ordenIds);

  if (error) throw new Error(error.message);

  return ((data ?? []) as ContainerLinkRow[]).map((row) => {
    const container = firstRelation(row.contenedores);
    return {
      orden_id: row.orden_id,
      contenedor_id: row.contenedor_id,
      identificador_embarque:
        container?.identificador_embarque?.trim() || row.contenedor_id.slice(0, 8),
    };
  });
}
