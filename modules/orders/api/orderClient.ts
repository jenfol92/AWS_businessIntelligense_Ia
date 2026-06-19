import { readJsonSafe } from "@/shared/api/readJsonSafe";

import type { OrderLinkedContainer, OrderListRow } from "@/modules/orders/types/orderList.types";

type ApiJson = {
  ok?: boolean;
  error?: string;
  code?: string;
};

async function parseApiResponse<T extends ApiJson>(res: Response): Promise<T> {
  const json = await readJsonSafe<T>(res);
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `Error HTTP ${res.status}`);
  }
  return json;
}

export type ConfirmedOrderSummary = {
  id: string;
  numero_orden: string;
  destino: string | null;
  fob_puerto: string | null;
  etd: string | null;
  eta: string | null;
  agente_contacto?: string | null;
  lead_time_produccion?: number | null;
  lead_time_transito?: number | null;
  coste_total_eur?: number;
  cbm_total?: number;
  contenedor?: OrderLinkedContainer | null;
};

export type FetchOrdersParams = {
  estado?: string;
  q?: string;
  puerto?: string;
  limit?: number;
};

export async function fetchOrders(params: FetchOrdersParams = {}): Promise<OrderListRow[]> {
  const search = new URLSearchParams();
  if (params.estado && params.estado !== "ALL") search.set("estado", params.estado);
  if (params.q?.trim()) search.set("q", params.q.trim());
  if (params.puerto?.trim()) search.set("puerto", params.puerto.trim());
  search.set("limit", String(params.limit ?? 200));

  const res = await fetch(`/api/orders?${search}`);
  const json = await parseApiResponse<{ ok: true; rows: OrderListRow[] }>(res);
  return json.rows ?? [];
}

export async function fetchConfirmedOrders(
  limit = 200,
): Promise<ConfirmedOrderSummary[]> {
  const rows = await fetchOrders({ estado: "confirmado", limit });
  return rows.map((row) => ({
    id: row.id,
    numero_orden: row.numero_orden,
    destino: row.destino,
    fob_puerto: row.fob_puerto,
    etd: row.etd ?? null,
    eta: row.eta,
    agente_contacto: row.agente_contacto ?? null,
    lead_time_produccion: row.lead_time_produccion,
    lead_time_transito: row.lead_time_transito,
    coste_total_eur: row.coste_total_eur,
    cbm_total: row.cbm_total,
    contenedor: row.contenedor ?? null,
  }));
}
