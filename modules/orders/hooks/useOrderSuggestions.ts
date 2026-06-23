"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchOrderSuggestions } from "@/modules/orders/api/orderClient";
import { fetchPlannerSummary } from "@/modules/planner/api/plannerClient";
import type { SugerenciaRow } from "@/modules/orders/types/orderSuggestions.types";
import type { ContainerOptimizationGroup } from "@/modules/planner/types/planner.types";

export type UseOrderSuggestionsResult = {
  sugerencias:     SugerenciaRow[];
  containerGroups: ContainerOptimizationGroup[];
  loading:         boolean;
  error:           string | null;
  loaded:          boolean;
  refresh:         () => Promise<void>;
};

/**
 * Gestiona la carga de sugerencias de compra y grupos de contenedor del planner.
 * Solo carga una vez (cuando `active` pasa a true por primera vez).
 * Expone `refresh()` para recarga manual (botón Actualizar).
 *
 * @param active - true cuando la pestaña de sugerencias está visible
 */
export function useOrderSuggestions(active: boolean): UseOrderSuggestionsResult {
  const [sugerencias,     setSugerencias]     = useState<SugerenciaRow[]>([]);
  const [containerGroups, setContainerGroups] = useState<ContainerOptimizationGroup[]>([]);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [loaded,          setLoaded]          = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, planner] = await Promise.all([
        fetchOrderSuggestions(),
        fetchPlannerSummary(),
      ]);
      setSugerencias(rows);
      setContainerGroups(planner.containerGroups);
      setLoaded(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }, []);

  // Carga lazy: solo la primera vez que la pestaña se abre
  useEffect(() => {
    if (active && !loaded) {
      refresh();
    }
  }, [active, loaded, refresh]);

  return { sugerencias, containerGroups, loading, error, loaded, refresh };
}
