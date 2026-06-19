"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchArrivalsTimeline,
  type FetchArrivalsTimelineParams,
} from "@/modules/planner/api/plannerClient";
import type { ArrivalsTimelineResponse } from "@/modules/planner/types/arrivals.types";

export function usePlannerArrivals(params: FetchArrivalsTimelineParams) {
  const [data, setData] = useState<ArrivalsTimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const json = await fetchArrivalsTimeline(params);
      setData(json);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "No se pudo cargar el cronograma.");
    } finally {
      setLoading(false);
    }
  }, [params.fromMonth, params.monthsCount, params.destination, params.status]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
}
