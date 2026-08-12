import type { StockagileOrderLineInput } from "./stockagileTypes";

type FetchStockagileOrdersParams = {
  startDate: string;
  endDate: string;
  path?: string | null;
};

export function isStockagileSyncEnabled(): boolean {
  return process.env.STOCKAGILE_SYNC_ENABLED === "true";
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name}.`);
  return value;
}

function buildUrl(baseUrl: string, path: string, params: FetchStockagileOrdersParams): URL {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.searchParams.set("startDate", params.startDate);
  url.searchParams.set("endDate", params.endDate);
  return url;
}

export async function fetchStockagileOrderLines(
  params: FetchStockagileOrdersParams,
): Promise<StockagileOrderLineInput[]> {
  if (!isStockagileSyncEnabled()) {
    throw new Error("STOCKAGILE_SYNC_ENABLED debe ser true para leer Stockagile API.");
  }

  const path = params.path?.trim();
  if (!path) {
    throw new Error(
      "Endpoint de pedidos Stockagile no confirmado. Configura el path real antes de usar fetchAndSync.",
    );
  }

  const baseUrl = requiredEnv("STOCKAGILE_API_BASE_URL");
  const token = requiredEnv("STOCKAGILE_API_TOKEN");
  const response = await fetch(buildUrl(baseUrl, path, params), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Stockagile API HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as unknown;
  if (Array.isArray(payload)) return payload as StockagileOrderLineInput[];
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: StockagileOrderLineInput[] }).data;
  }

  throw new Error("Respuesta Stockagile no reconocida. Se espera array o { data: [] }.");
}
