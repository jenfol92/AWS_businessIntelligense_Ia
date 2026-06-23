import { readJsonSafe } from "@/shared/api/readJsonSafe";
import type { PlannerDestinationOption } from "@/modules/planner/repositories/plannerDestinationsRepository";
import type { ArrivalsTimelineResponse } from "@/modules/planner/types/arrivals.types";
import type { ContainerOptimizationGroup } from "@/modules/planner/types/planner.types";

type ApiJson = {
  ok?: boolean;
  error?: string;
};

async function parseApiResponse<T extends ApiJson>(res: Response): Promise<T> {
  const json = await readJsonSafe<T>(res);
  if (!res.ok || json.ok === false) {
    throw new Error(json.error ?? `Error HTTP ${res.status}`);
  }
  return json;
}

export type FetchArrivalsTimelineParams = {
  fromMonth: string;
  monthsCount: number;
  destination?: string;
  status?: string;
};

export function buildArrivalsTimelineUrl(
  params: FetchArrivalsTimelineParams,
): string {
  const q = new URLSearchParams({
    fromMonth: params.fromMonth,
    months: String(params.monthsCount),
  });
  if (params.destination && params.destination !== "ALL") {
    q.set("destination", params.destination);
  }
  if (params.status && params.status !== "ALL") {
    q.set("status", params.status);
  }
  return `/api/planner/arrivals?${q.toString()}`;
}

export async function fetchArrivalsTimeline(
  params: FetchArrivalsTimelineParams,
): Promise<ArrivalsTimelineResponse> {
  const res = await fetch(buildArrivalsTimelineUrl(params));
  return parseApiResponse<ArrivalsTimelineResponse>(res);
}

export type PlannerDestinationOptionsResponse = {
  ok: true;
  options: PlannerDestinationOption[];
};

export async function fetchPlannerDestinationOptions(): Promise<PlannerDestinationOptionsResponse> {
  const res = await fetch("/api/planner/destinations");
  return parseApiResponse<PlannerDestinationOptionsResponse>(res);
}

// ─── Planner summary (sugerencias / grupos de contenedor) ─────────────────────

export type PlannerSummaryResult = {
  containerGroups: ContainerOptimizationGroup[];
};

/**
 * Llama a GET /api/planner/summary con los parámetros fijos de la página de
 * sugerencias de compra. Nunca lanza: devuelve containerGroups vacío si falla.
 */
export async function fetchPlannerSummary(): Promise<PlannerSummaryResult> {
  try {
    const params = new URLSearchParams({
      windowDays:          "90",
      country:             "ALL",
      channel:             "ALL",
      scenario:            "base",
      horizonMonths:       "12",
      includeNewProducts:  "true",
    });
    const res  = await fetch(`/api/planner/summary?${params}`);
    const json = await res.json();
    if (json.ok && json.purchasePlan?.containerGroups) {
      return { containerGroups: json.purchasePlan.containerGroups as ContainerOptimizationGroup[] };
    }
  } catch {
    // No bloquear la UI
  }
  return { containerGroups: [] };
}
