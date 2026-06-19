import { readJsonSafe } from "@/shared/api/readJsonSafe";
import type { CreateContainerFromOrderPayload } from "@/modules/containers/types/createContainer.types";

type ApiJson = {
  ok?: boolean;
  error?: string;
  message?: string;
};

async function parseApiResponse<T extends ApiJson>(res: Response): Promise<T> {
  const json = await readJsonSafe<T>(res);

  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? json.message ?? `Error HTTP ${res.status}`);
  }

  return json;
}

export type FetchContainersResult = {
  ok: true;
  rows: unknown[];
};

export type FetchContainerDetailResult = {
  ok: true;
  contenedor: unknown;
  ordenes: unknown[];
  stockStatus?: unknown;
  costAllocationPreview?: unknown;
  warnings?: string[];
};

export type UpdateContainerResult = {
  ok: true;
  contenedor?: unknown;
  stockActivation?: unknown;
};

export type FacturarContainerCostsResult = {
  ok: true;
  contenedor_id: string;
  cbm_total_contenedor: number;
  coste_flete_total: number;
  coste_transito_total: number;
  gastos_llegada_total: number;
  lineas_procesadas: number;
  coste_total_logistico: number;
  producto_costos_upserted: number;
  warnings: string[];
  lineas: unknown[];
};

export type CreateContainerResult = {
  ok: true;
  contenedor: { id?: string } & Record<string, unknown>;
};

export async function createContainerFromOrder(
  payload: CreateContainerFromOrderPayload,
): Promise<CreateContainerResult> {
  const res = await fetch("/api/containers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseApiResponse<CreateContainerResult>(res);
}

export async function linkOrderToContainer(
  contenedorId: string,
  ordenId: string,
): Promise<{ ok: true }> {
  const res = await fetch(`/api/containers/${contenedorId}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orden_id: ordenId }),
  });
  return parseApiResponse<{ ok: true }>(res);
}

export async function fetchContainers(estado?: string): Promise<FetchContainersResult> {
  const params = new URLSearchParams();
  if (estado && estado !== "ALL") params.set("estado", estado);
  const res = await fetch(`/api/containers?${params}`);
  return parseApiResponse<FetchContainersResult>(res);
}

export async function fetchContainerDetail(
  contenedorId: string,
): Promise<FetchContainerDetailResult> {
  const res = await fetch(`/api/containers/${contenedorId}`);
  return parseApiResponse<FetchContainerDetailResult>(res);
}

export async function updateContainer(
  contenedorId: string,
  payload: unknown,
): Promise<UpdateContainerResult> {
  const res = await fetch(`/api/containers/${contenedorId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseApiResponse<UpdateContainerResult>(res);
}

export async function facturarContainerCosts(
  contenedorId: string,
): Promise<FacturarContainerCostsResult> {
  const res = await fetch(`/api/containers/${contenedorId}/facturar`, {
    method: "POST",
  });
  return parseApiResponse<FacturarContainerCostsResult>(res);
}

export async function unlinkContainerOrder(
  contenedorId: string,
  ordenId: string,
): Promise<{ ok: true }> {
  const res = await fetch(
    `/api/containers/${contenedorId}/orders?orden_id=${ordenId}`,
    { method: "DELETE" },
  );
  return parseApiResponse<{ ok: true }>(res);
}
