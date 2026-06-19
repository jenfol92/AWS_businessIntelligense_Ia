"use client";

import { useEffect, useState } from "react";
import type { PlannerDestinationOption } from "@/modules/planner/repositories/plannerDestinationsRepository";
import { fetchPlannerDestinationOptions } from "@/modules/planner/api/plannerClient";

const FALLBACK_OPTIONS: PlannerDestinationOption[] = [
  { value: "ALL", label: "Todos" },
  { value: "FBA", label: "FBA" },
  { value: "ES", label: "ES" },
];

export function usePlannerDestinationOptions() {
  const [options, setOptions] = useState<PlannerDestinationOption[]>(FALLBACK_OPTIONS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const json = await fetchPlannerDestinationOptions();
        if (!cancelled && json.options.length > 0) {
          setOptions(json.options);
        }
      } catch {
        if (!cancelled) setOptions(FALLBACK_OPTIONS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { options, loading };
}
