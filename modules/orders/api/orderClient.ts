import { readJsonSafe } from "@/shared/api/readJsonSafe";

import type { OrderLinkedContainer, OrderListRow } from "@/modules/orders/types/orderList.types";
import type { SugerenciaRow } from "@/modules/orders/types/orderSuggestions.types";
import type { ProductoSearch } from "@/modules/orders/types/orderProductSearch.types";
import type { RawOrderDetail } from "@/modules/orders/types/orderFormState.types";
import type {
  OrderLeadTimeSuggestion,
  OrderLeadTimeSuggestionRequestItem,
} from "@/modules/orders/types/orderLeadTimeSuggestion.types";

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

// ─── Sugerencias ─────────────────────────────────────────────────────────────

/**
 * Carga las sugerencias de compra desde GET /api/orders/suggestions.
 */
export async function fetchOrderSuggestions(): Promise<SugerenciaRow[]> {
  const res  = await fetch("/api/orders/suggestions");
  const json = await parseApiResponse<{ ok: true; rows: SugerenciaRow[] }>(res);
  return json.rows ?? [];
}

export async function fetchOrderLeadTimeSuggestions(
  items: OrderLeadTimeSuggestionRequestItem[],
): Promise<OrderLeadTimeSuggestion[]> {
  const res = await fetch("/api/orders/lead-time-suggestions", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ items }),
  });
  const json = await parseApiResponse<{
    ok: true;
    suggestions: OrderLeadTimeSuggestion[];
  }>(res);
  return json.suggestions ?? [];
}

// ─── Proforma upload ──────────────────────────────────────────────────────────

/**
 * Sube un PDF de proforma firmada para una orden confirmada.
 * Contrato: FormData con campo "file".
 */
export async function uploadOrderProforma(
  orderId: string,
  file: File,
): Promise<void> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`/api/orders/${orderId}/proforma-upload`, {
    method: "POST",
    body:   fd,
  });
  await parseApiResponse(res);
}

// ─── Reabrir orden ────────────────────────────────────────────────────────────

/**
 * Reabre una orden confirmada a estado borrador.
 * Contrato: body { motivo: string }.
 */
export async function reopenOrder(
  orderId: string,
  motivo: string,
): Promise<void> {
  const res = await fetch(`/api/orders/${orderId}/reopen`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ motivo }),
  });
  await parseApiResponse(res);
}

// ─── Detalle de orden ─────────────────────────────────────────────────────────

/**
 * Carga el detalle completo de una orden (cabecera + ítems) desde GET /api/orders/:id.
 * Devuelve null si la respuesta no es ok o si ocurre un error de red.
 * No lanza: el comportamiento silencioso replica el del useEffect original en OrderFormModal.
 */
export async function fetchOrderDetail(orderId: string): Promise<RawOrderDetail | null> {
  try {
    const res  = await fetch(`/api/orders/${orderId}`);
    const json = await res.json();
    if (json.ok) {
      return {
        orden: (json.orden ?? {}) as Record<string, unknown>,
        items: (json.items ?? []) as Record<string, unknown>[],
      };
    }
  } catch {
    // Silencioso: replica comportamiento original
  }
  return null;
}

// ─── Búsqueda de productos ────────────────────────────────────────────────────

/**
 * Busca productos para añadir a una orden vía GET /api/orders/products-search.
 * Devuelve array vacío si la búsqueda falla.
 */
export async function searchOrderProducts(q: string): Promise<ProductoSearch[]> {
  try {
    const res  = await fetch(`/api/orders/products-search?q=${encodeURIComponent(q)}`);
    const json = await parseApiResponse<{ ok: true; rows: ProductoSearch[] }>(res);
    return json.rows ?? [];
  } catch {
    return [];
  }
}

// ─── Órdenes confirmadas ──────────────────────────────────────────────────────

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
