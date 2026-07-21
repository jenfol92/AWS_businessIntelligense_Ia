import { createSupabaseRouteClient } from "@/server/supabase/routeClient";
import type { OrdenCompraRow } from "@/modules/orders/types/orderPersistence.types";

export type ConfirmedOrderOperationsPatch = {
  destino?: string | null;
  tipo_envio?: "propio" | "amazon_agl";
  etd?: string | null;
  eta?: string | null;
  eta_real?: string | null;
  lead_time_produccion?: number | null;
  lead_time_transito?: number | null;
  agente_id?: string | null;
  numero_pedido_agente?: string | null;
  notas?: string | null;
  tipo_cambio_moneda_eur?: number | null;
};

const ALLOWED_KEYS = new Set<keyof ConfirmedOrderOperationsPatch>([
  "destino",
  "tipo_envio",
  "etd",
  "eta",
  "eta_real",
  "lead_time_produccion",
  "lead_time_transito",
  "agente_id",
  "numero_pedido_agente",
  "notas",
  "tipo_cambio_moneda_eur",
]);

function requireSingleRpcRow<T>(data: T | T[] | null, context: string): T {
  if (Array.isArray(data)) {
    if (data.length === 1) return data[0] as T;
    throw new Error(`${context}: respuesta RPC inesperada (${data.length} filas).`);
  }
  if (!data) throw new Error(`${context}: respuesta RPC vacía.`);
  return data;
}

function sanitizePatch(input: unknown): ConfirmedOrderOperationsPatch {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("El patch operativo debe ser un objeto.");
  }

  const source = input as Record<string, unknown>;
  const rejected = Object.keys(source).filter(
    (key) => !ALLOWED_KEYS.has(key as keyof ConfirmedOrderOperationsPatch),
  );
  if (rejected.length > 0) {
    throw new Error(`Campos no permitidos en edición operativa: ${rejected.join(", ")}.`);
  }

  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined),
  ) as ConfirmedOrderOperationsPatch;
}

/** Actualiza únicamente datos operativos de una orden confirmada mediante RPC. */
export async function updateConfirmedOrderOperationsService(
  orderId: string,
  input: unknown,
): Promise<OrdenCompraRow> {
  const supabase = createSupabaseRouteClient();
  const patch = sanitizePatch(input);

  const { data, error } = await supabase.rpc(
    "update_confirmed_purchase_order_operations",
    {
      p_order_id: orderId,
      p_patch: patch,
    },
  );

  if (error) {
    throw new Error(error.message || "No se pudieron guardar los cambios operativos.");
  }

  return requireSingleRpcRow(
    data as OrdenCompraRow | OrdenCompraRow[] | null,
    "update_confirmed_purchase_order_operations",
  );
}
