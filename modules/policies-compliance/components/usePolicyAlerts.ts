"use client";

/**
 * modules/policies-compliance/components/usePolicyAlerts.ts
 *
 * Fetch hook: GET /api/policies/alerts
 * Returns the GroupedPolicyAlert[] that the backend already assembled.
 * No transformation. No grouping. No state calculation.
 */

import { useCallback, useEffect, useState } from "react";
import type { GroupedPolicyAlert } from "../types/policyCompliance.types";

type UsePolicyAlertsState = {
  data: GroupedPolicyAlert[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  syncing: boolean;
  syncError: string | null;
  triggerSync: () => Promise<void>;
};

export function usePolicyAlerts(): UsePolicyAlertsState {
  const [data, setData] = useState<GroupedPolicyAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);

    fetch("/api/policies/alerts", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { ok: boolean; data?: GroupedPolicyAlert[]; error?: string }) => {
        if (!body.ok) throw new Error(body.error ?? "Error al cargar alertas.");
        setData(body.data ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Error desconocido.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const triggerSync = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
  
    try {
      const res = await fetch("/api/policies/alerts/sync", {
        method: "POST",
        cache: "no-store",
      });
  
      if (!res.ok) {
        // La API puede devolver texto o no devolver nada
        const msg = await res.text();
        throw new Error(msg || "Error al sincronizar con Amazon.");
      }
  
      // Si la API devuelve 204 No Content → esto es éxito
      load(); // refresca las alertas
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Error de sincronización.");
    } finally {
      setSyncing(false);
    }
  }, [load]);
  

  return { data, loading, error, refresh: load, syncing, syncError, triggerSync };
}
